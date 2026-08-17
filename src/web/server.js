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
      const { produtoId, tipo, quantidade, parceriaId, faccaoNome } = req.body;
      const registradoPor = req.discordUser.nome;
      const registradoPorDiscordId = req.discordUser.id;

      if (!produtoId || !['pista', 'parceria'].includes(tipo) || !Number.isInteger(quantidade) || quantidade <= 0) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }

      const config = await serverService.getConfig(guildId);
      const produto = (config.vendas?.produtos || []).find((p) => p.id === produtoId);
      if (!produto) {
        return res.status(404).json({ error: 'Produto não encontrado.' });
      }

      // Recalcula o preço no servidor com o valor atual configurado - nunca
      // confia no total calculado pelo cliente pra gravar no banco
      const precoInfo = config.vendas?.precos?.[produtoId];
      const preco = tipo === 'pista' ? precoInfo?.preco_pista : precoInfo?.preco_parceria;
      if (!preco) {
        return res.status(400).json({ error: `Preço de ${tipo === 'pista' ? 'Pista' : 'Parceria'} não configurado pra esse produto.` });
      }

      const valorTotal = quantidade * preco;

      // Se uma parceria específica foi selecionada (só faz sentido em venda
      // com parceria), resolve o nome dela no servidor - nunca confia no
      // texto que o cliente mandaria pra esse caso. Em venda "pista" o nome
      // é texto livre digitado mesmo.
      let faccaoNomeFinal = null;
      if (tipo === 'parceria' && parceriaId) {
        faccaoNomeFinal = await vendaService.getNomeFaccaoPorParceriaId(guildId, parceriaId);
        if (!faccaoNomeFinal) {
          return res.status(400).json({ error: 'Parceria selecionada não foi encontrada.' });
        }
      } else if (tipo === 'pista') {
        faccaoNomeFinal = (faccaoNome || '').trim() || null;
      }

      // Venda com parceria sem facção identificada é permitida - só avisamos,
      // não bloqueamos (pedido explícito)
      const avisoSemFaccao = tipo === 'parceria' && !faccaoNomeFinal;

      const venda = await vendaService.registrarVenda(guildId, {
        produtoId,
        produtoNome: produto.nome,
        tipo,
        quantidade,
        precoUnitario: preco,
        valorTotal,
        parceriaId: tipo === 'parceria' ? (parceriaId || null) : null,
        faccaoNome: faccaoNomeFinal,
        registradoPor,
        registradoPorDiscordId,
      });

      // Publicar no canal de vendas confirmadas, se configurado
      try {
        const canalVendasId = config.vendas?.canal_vendas_id;
        const guild = client.guilds.cache.get(guildId);
        const canal = canalVendasId ? guild?.channels.cache.get(canalVendasId) : null;

        if (canal) {
          const { EmbedBuilder } = require('discord.js');
          const embed = new EmbedBuilder()
            .setTitle('🧮 Venda Confirmada')
            .setColor(tipo === 'parceria' ? 0x3498db : 0x2ecc71)
            .addFields(
              { name: '📦 Produto', value: produto.nome, inline: true },
              { name: '🏷️ Tipo', value: tipo === 'pista' ? 'Sem Parceria (Pista)' : 'Com Parceria', inline: true },
              { name: '🔢 Quantidade', value: String(quantidade), inline: true },
              { name: '💵 Preço Unitário', value: `R$ ${preco.toFixed(2)}`, inline: true },
              { name: '💰 Valor Total', value: `R$ ${valorTotal.toFixed(2)}`, inline: true },
              { name: '🏴 Facção', value: faccaoNomeFinal || (avisoSemFaccao ? '⚠️ Não identificada' : 'Não informada'), inline: true },
              { name: '👤 Registrado por', value: registradoPor || 'Não informado', inline: false }
            )
            .setTimestamp();

          await canal.send({ embeds: [embed] });
        }
      } catch (err) {
        console.error('Erro ao publicar venda confirmada no canal:', err.message);
      }

      res.json({ success: true, valorTotal, aviso: avisoSemFaccao ? 'Venda com parceria registrada sem facção identificada.' : null });
    } catch (err) {
      console.error('Erro ao registrar venda:', err);
      res.status(500).json({ error: 'Erro ao registrar venda.' });
    }
  });

  app.listen(PORT, () => {
    console.log(`🌐 Calculadora de vendas rodando na porta ${PORT}`);
  });
}

module.exports = { iniciarServidorWeb };
