const express = require('express');
const path = require('path');
const crypto = require('crypto');
const serverService = require('../services/serverService');
const vendaService = require('../services/vendaService');

const SESSAO_DURACAO_MS = 12 * 60 * 60 * 1000; // 12h
const COOKIE_NOME = 'rbk_sessao';

// Calculadora de vendas web - roda no mesmo processo/serviço do bot. Acesso
// exige login via Discord OAuth2 e um dos cargos configurados em
// "Cargos que Podem Usar a Calculadora" - sem isso não dá pra nem ver a
// página. A identidade (nome/id Discord) vem da sessão verificada, nunca do
// que o cliente manda no corpo da requisição.
function iniciarServidorWeb(client) {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const guildId = process.env.GUILD_ID;
  const sessionSecret = process.env.SESSION_SECRET;
  const redirectUri = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/auth/discord/callback`;

  if (!sessionSecret) {
    console.error('⚠️ SESSION_SECRET não configurado - login da calculadora de vendas vai falhar.');
  }

  function assinarSessao(payload) {
    const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const hmac = crypto.createHmac('sha256', sessionSecret || '').update(json).digest('base64url');
    return `${json}.${hmac}`;
  }

  function verificarSessao(valor) {
    if (!valor) return null;
    const [json, hmac] = valor.split('.');
    if (!json || !hmac) return null;
    const esperado = crypto.createHmac('sha256', sessionSecret || '').update(json).digest('base64url');
    const bufA = Buffer.from(hmac);
    const bufB = Buffer.from(esperado);
    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;
    try {
      const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'));
      if (!payload.exp || payload.exp < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function lerSessaoDoRequest(req) {
    const raw = req.headers.cookie || '';
    const par = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE_NOME}=`));
    if (!par) return null;
    return verificarSessao(decodeURIComponent(par.slice(COOKIE_NOME.length + 1)));
  }

  function requireAuth(req, res, next) {
    const sessao = lerSessaoDoRequest(req);
    if (!sessao) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado.' });
      return res.redirect('/login');
    }
    req.discordUser = sessao;
    next();
  }

  app.use(express.json());

  app.get('/login', (req, res) => {
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', process.env.CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    res.redirect(url.toString());
  });

  app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NOME}=; Path=/; HttpOnly; Max-Age=0`);
    res.redirect('/login');
  });

  app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Código de autorização ausente.');

    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) throw new Error('Falha ao trocar código por token de acesso');
      const tokenData = await tokenRes.json();

      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) throw new Error('Falha ao buscar dados do usuário Discord');
      const usuarioDiscord = await userRes.json();

      const guild = client.guilds.cache.get(guildId);
      const membro = guild ? await guild.members.fetch(usuarioDiscord.id).catch(() => null) : null;

      if (!membro) {
        return res.status(403).send('Você precisa estar no servidor Discord da facção pra usar a calculadora.');
      }

      const config = await serverService.getConfig(guildId);
      const cargoCalculadoraIds = config.vendas?.cargo_calculadora_ids || [];
      const temPermissao =
        membro.permissions.has('Administrator') ||
        (cargoCalculadoraIds.length > 0 && membro.roles.cache.some((r) => cargoCalculadoraIds.includes(r.id)));

      if (!temPermissao) {
        return res.status(403).send('Você não tem o cargo necessário pra usar a calculadora de vendas. Fale com um administrador.');
      }

      const nomeExibicao = membro.nickname || usuarioDiscord.global_name || usuarioDiscord.username;
      const sessao = assinarSessao({
        id: usuarioDiscord.id,
        username: usuarioDiscord.username,
        nome: nomeExibicao,
        exp: Date.now() + SESSAO_DURACAO_MS,
      });

      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NOME}=${encodeURIComponent(sessao)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSAO_DURACAO_MS / 1000)}; Secure`
      );
      res.redirect('/');
    } catch (err) {
      console.error('Erro no login via Discord:', err);
      res.status(500).send('Erro ao autenticar com o Discord. Tente novamente.');
    }
  });

  app.use(express.static(path.join(__dirname, 'public'), { index: false }));

  app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.get('/api/vendas/me', requireAuth, (req, res) => {
    res.json({ id: req.discordUser.id, nome: req.discordUser.nome });
  });

  app.get('/api/vendas/produtos', requireAuth, async (req, res) => {
    try {
      const config = await serverService.getConfig(guildId);
      const produtos = config.vendas?.produtos || [];
      const precos = config.vendas?.precos || {};

      const lista = produtos.map((p) => ({
        id: p.id,
        nome: p.nome,
        preco_pista: precos[p.id]?.preco_pista ?? null,
        preco_parceria: precos[p.id]?.preco_parceria ?? null,
      }));

      res.json(lista);
    } catch (err) {
      console.error('Erro ao buscar produtos de venda:', err);
      res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
  });

  app.get('/api/vendas/faccoes-parceria', requireAuth, async (req, res) => {
    try {
      const faccoes = await vendaService.listarFaccoesParceria(guildId);
      res.json(faccoes);
    } catch (err) {
      console.error('Erro ao buscar facções de parceria:', err);
      res.status(500).json({ error: 'Erro ao buscar facções' });
    }
  });

  app.post('/api/vendas/registrar', requireAuth, async (req, res) => {
    try {
      const { tipo, parceriaId, faccaoNome } = req.body;
      const registradoPor = req.discordUser.nome;
      const registradoPorDiscordId = req.discordUser.id;

      // Formato novo: itens: [{produtoId, quantidade}, ...]. Ainda aceita o
      // antigo (produtoId + quantidade na raiz) como venda de um item só.
      const itensBrutos = Array.isArray(req.body.itens)
        ? req.body.itens
        : (req.body.produtoId ? [{ produtoId: req.body.produtoId, quantidade: req.body.quantidade }] : []);

      if (!['pista', 'parceria'].includes(tipo) || itensBrutos.length === 0 || itensBrutos.length > 20) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }

      // Mesmo produto repetido em duas linhas vira uma só (soma as quantidades)
      const qtdPorProduto = new Map();
      for (const it of itensBrutos) {
        const q = Number(it && it.quantidade);
        if (!it || !it.produtoId || !Number.isInteger(q) || q <= 0) {
          return res.status(400).json({ error: 'Dados inválidos.' });
        }
        const chave = String(it.produtoId);
        qtdPorProduto.set(chave, (qtdPorProduto.get(chave) || 0) + q);
      }

      const config = await serverService.getConfig(guildId);
      const produtosCfg = config.vendas?.produtos || [];
      const precosCfg = config.vendas?.precos || {};
      const tipoLabel = tipo === 'pista' ? 'Pista' : 'Parceria';

      // Recalcula cada preço no servidor com o valor atual configurado -
      // nunca confia no total calculado pelo cliente pra gravar no banco
      const itens = [];
      for (const [produtoId, quantidade] of qtdPorProduto) {
        const produto = produtosCfg.find((p) => p.id === produtoId);
        if (!produto) return res.status(404).json({ error: 'Produto não encontrado.' });
        const precoInfo = precosCfg[produtoId];
        const preco = tipo === 'pista' ? precoInfo?.preco_pista : precoInfo?.preco_parceria;
        if (!preco) {
          return res.status(400).json({ error: `Preço de ${tipoLabel} não configurado pra ${produto.nome}.` });
        }
        itens.push({ produtoId, produtoNome: produto.nome, quantidade, precoUnitario: preco, valorTotal: quantidade * preco });
      }
      const valorTotal = itens.reduce((s, i) => s + i.valorTotal, 0);

      // Facção: em venda com parceria resolve o nome pelo id no servidor
      // (nunca confia no texto do cliente); em venda "pista" é texto livre.
      let faccaoNomeFinal = null;
      if (tipo === 'parceria' && parceriaId) {
        faccaoNomeFinal = await vendaService.getNomeFaccaoPorParceriaId(guildId, parceriaId);
        if (!faccaoNomeFinal) {
          return res.status(400).json({ error: 'Parceria selecionada não foi encontrada.' });
        }
      } else if (tipo === 'pista') {
        faccaoNomeFinal = (faccaoNome || '').trim() || null;
      }

      // Venda com parceria sem facção identificada é permitida - só avisamos
      const avisoSemFaccao = tipo === 'parceria' && !faccaoNomeFinal;

      const vendaGrupoId = `${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
      await vendaService.registrarVendasEmGrupo(guildId, {
        tipo,
        parceriaId: tipo === 'parceria' ? (parceriaId || null) : null,
        faccaoNome: faccaoNomeFinal,
        registradoPor,
        registradoPorDiscordId,
        vendaGrupoId,
      }, itens);

      // Um embed só no canal de vendas confirmadas, listando todos os itens
      try {
        const canalVendasId = config.vendas?.canal_vendas_id;
        const guild = client.guilds.cache.get(guildId);
        const canal = canalVendasId ? guild?.channels.cache.get(canalVendasId) : null;

        if (canal) {
          const { EmbedBuilder } = require('discord.js');
          const fmt = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          const listaItens = itens
            .map((i) => `**${i.produtoNome}** — ${i.quantidade} × ${fmt(i.precoUnitario)} = ${fmt(i.valorTotal)}`)
            .join('\n')
            .slice(0, 1024);
          const totalUnidades = itens.reduce((s, i) => s + i.quantidade, 0);

          const embed = new EmbedBuilder()
            .setTitle(itens.length > 1 ? `🧮 Venda Confirmada (${itens.length} produtos)` : '🧮 Venda Confirmada')
            .setColor(tipo === 'parceria' ? 0x3498db : 0x2ecc71)
            .addFields(
              { name: '📦 Itens', value: listaItens, inline: false },
              { name: '🏷️ Tipo', value: tipo === 'pista' ? 'Sem Parceria (Pista)' : 'Com Parceria', inline: true },
              { name: '🔢 Unidades', value: String(totalUnidades), inline: true },
              { name: '💰 Valor Total', value: fmt(valorTotal), inline: true },
              { name: '🏴 Facção', value: faccaoNomeFinal || (avisoSemFaccao ? '⚠️ Não identificada' : 'Não informada'), inline: true },
              { name: '👤 Registrado por', value: registradoPor || 'Não informado', inline: false }
            )
            .setFooter({ text: `Venda ${vendaGrupoId}` })
            .setTimestamp();

          await canal.send({ embeds: [embed] });
        }
      } catch (err) {
        console.error('Erro ao publicar venda confirmada no canal:', err.message);
      }

      res.json({
        success: true,
        valorTotal,
        itens,
        grupoId: vendaGrupoId,
        aviso: avisoSemFaccao ? 'Venda com parceria registrada sem facção identificada.' : null,
      });
    } catch (err) {
      console.error('Erro ao registrar venda:', err);
      res.status(500).json({ error: 'Erro ao registrar venda.' });
    }
  });

  // ===== Relatório de vendas por período =====

  // Valida ?inicio=YYYY-MM-DD&fim=YYYY-MM-DD. Datas são dias no horário de
  // Brasília, inclusivas. Limita a 1 ano pra não deixar puxar a base inteira.
  function validarPeriodo(query) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const inicio = String(query.inicio || '');
    const fim = String(query.fim || '');
    if (!re.test(inicio) || !re.test(fim)) return { erro: 'Informe data de início e fim no formato AAAA-MM-DD.' };
    const dIni = new Date(inicio + 'T00:00:00Z');
    const dFim = new Date(fim + 'T00:00:00Z');
    if (isNaN(dIni) || isNaN(dFim)) return { erro: 'Data inválida.' };
    if (dIni > dFim) return { erro: 'A data de início não pode ser depois da data de fim.' };
    const dias = Math.round((dFim - dIni) / 86400000) + 1;
    if (dias > 366) return { erro: 'O período máximo do relatório é de 1 ano.' };
    return { inicio, fim, dias };
  }

  // Numera as vendas (grupos) na ordem em que aparecem: todas as linhas de
  // uma venda com vários produtos recebem o mesmo numeroVenda
  function numerarVendas(vendas) {
    const numeroPorGrupo = new Map();
    for (const v of vendas) {
      if (!numeroPorGrupo.has(v.grupo)) numeroPorGrupo.set(v.grupo, numeroPorGrupo.size + 1);
      v.numeroVenda = numeroPorGrupo.get(v.grupo);
    }
    return numeroPorGrupo.size;
  }

  // Agrega as vendas em totais gerais e quebras por tipo, produto e vendedor
  function montarResumo(vendas) {
    const porTipo = { pista: { vendas: 0, unidades: 0, valor: 0 }, parceria: { vendas: 0, unidades: 0, valor: 0 } };
    const porProduto = new Map();
    const porVendedor = new Map();
    let totalUnidades = 0;
    let valorTotal = 0;

    for (const v of vendas) {
      totalUnidades += v.quantidade;
      valorTotal += v.valorTotal;

      const t = porTipo[v.tipo] || (porTipo[v.tipo] = { vendas: 0, unidades: 0, valor: 0 });
      t.vendas++; t.unidades += v.quantidade; t.valor += v.valorTotal;

      const prod = porProduto.get(v.produto) || { nome: v.produto, vendas: 0, unidades: 0, valor: 0 };
      prod.vendas++; prod.unidades += v.quantidade; prod.valor += v.valorTotal;
      porProduto.set(v.produto, prod);

      const chaveVend = v.vendedorId || v.vendedor || '—';
      const vend = porVendedor.get(chaveVend) || { nome: v.vendedor || 'Não informado', vendas: 0, unidades: 0, valor: 0 };
      vend.vendas++; vend.unidades += v.quantidade; vend.valor += v.valorTotal;
      porVendedor.set(chaveVend, vend);
    }

    const ordenar = (m) => [...m.values()].sort((a, b) => b.valor - a.valor);
    return {
      totalVendas: vendas.length,
      totalLancamentos: new Set(vendas.map((v) => v.grupo)).size,
      totalUnidades,
      valorTotal,
      porTipo,
      porProduto: ordenar(porProduto),
      porVendedor: ordenar(porVendedor),
    };
  }

  app.get('/api/vendas/relatorio', requireAuth, async (req, res) => {
    const periodo = validarPeriodo(req.query);
    if (periodo.erro) return res.status(400).json({ error: periodo.erro });
    try {
      const vendas = await vendaService.listarVendasPorPeriodo(guildId, periodo.inicio, periodo.fim);
      numerarVendas(vendas);
      res.json({ inicio: periodo.inicio, fim: periodo.fim, vendas, resumo: montarResumo(vendas) });
    } catch (err) {
      console.error('Erro ao gerar relatório de vendas:', err);
      res.status(500).json({ error: 'Erro ao gerar relatório.' });
    }
  });

  // CSV pronto pro Excel em pt-BR: BOM UTF-8, separador ";" e decimal com
  // vírgula. Vai como download (Content-Disposition: attachment).
  app.get('/api/vendas/relatorio.csv', requireAuth, async (req, res) => {
    const periodo = validarPeriodo(req.query);
    if (periodo.erro) return res.status(400).send(periodo.erro);
    try {
      const vendas = await vendaService.listarVendasPorPeriodo(guildId, periodo.inicio, periodo.fim);
      numerarVendas(vendas);
      const resumo = montarResumo(vendas);

      const num = (n) => Number(n).toFixed(2).replace('.', ',');
      const cel = (v) => {
        const t = v == null ? '' : String(v);
        return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };
      const dataBR = (iso) => iso.split('-').reverse().join('/');
      const tipoLabel = (t) => (t === 'parceria' ? 'Com Parceria' : 'Pista');

      const linhas = [];
      linhas.push(['Venda', 'Data', 'Hora', 'Produto', 'Tipo', 'Quantidade', 'Preço Unitário', 'Valor Total', 'Facção', 'Vendedor'].join(';'));
      for (const v of vendas) {
        linhas.push([
          '#' + v.numeroVenda, dataBR(v.data), v.hora, cel(v.produto), tipoLabel(v.tipo), v.quantidade,
          num(v.precoUnitario), num(v.valorTotal), cel(v.faccao || ''), cel(v.vendedor || ''),
        ].join(';'));
      }
      linhas.push('');
      linhas.push(['TOTAL', '', '', '', '', resumo.totalUnidades, '', num(resumo.valorTotal), '', ''].join(';'));
      linhas.push('');
      linhas.push(['Período', dataBR(periodo.inicio) + ' a ' + dataBR(periodo.fim)].join(';'));
      linhas.push(['Vendas', resumo.totalLancamentos, resumo.totalVendas + ' linha(s)'].join(';'));
      linhas.push(['Pista', resumo.porTipo.pista.vendas + ' venda(s)', num(resumo.porTipo.pista.valor)].join(';'));
      linhas.push(['Com Parceria', resumo.porTipo.parceria.vendas + ' venda(s)', num(resumo.porTipo.parceria.valor)].join(';'));

      const csv = '﻿' + linhas.join('\r\n');
      const nomeArquivo = `vendas_${periodo.inicio}_a_${periodo.fim}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
      res.send(csv);
    } catch (err) {
      console.error('Erro ao exportar relatório de vendas:', err);
      res.status(500).send('Erro ao exportar relatório.');
    }
  });

  app.listen(PORT, () => {
    console.log(`🌐 Calculadora de vendas rodando na porta ${PORT}`);
  });
}

module.exports = { iniciarServidorWeb };
