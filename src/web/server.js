const express = require('express');
const path = require('path');
const serverService = require('../services/serverService');
const vendaService = require('../services/vendaService');

// Calculadora de vendas web - roda no mesmo processo/serviço do bot. Sem
// autenticação por escolha (link direto pro time de vendas usar), então
// não sabemos "quem" está acessando - o campo "registrado por" no formulário
// é auto-declarado, não verificado.
function iniciarServidorWeb(client) {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const guildId = process.env.GUILD_ID;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/vendas/produtos', async (req, res) => {
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

  app.get('/api/vendas/faccoes-parceria', async (req, res) => {
    try {
      const faccoes = await vendaService.listarFaccoesParceria(guildId);
      res.json(faccoes);
    } catch (err) {
      console.error('Erro ao buscar facções de parceria:', err);
      res.status(500).json({ error: 'Erro ao buscar facções' });
    }
  });

  app.post('/api/vendas/registrar', async (req, res) => {
    try {
      const { produtoId, tipo, quantidade, faccaoNome, registradoPor } = req.body;

      if (!produtoId || !['pista', 'parceria'].includes(tipo) || !Number.isFinite(quantidade) || quantidade <= 0) {
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

      // Venda com parceria sem facção identificada é permitida - só avisamos,
      // não bloqueamos (pedido explícito)
      const avisoSemFaccao = tipo === 'parceria' && !faccaoNome;

      const venda = await vendaService.registrarVenda(guildId, {
        produtoId,
        produtoNome: produto.nome,
        tipo,
        quantidade,
        precoUnitario: preco,
        valorTotal,
        faccaoNome: faccaoNome || null,
        registradoPor: registradoPor || null,
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
              { name: '🏴 Facção', value: faccaoNome || (avisoSemFaccao ? '⚠️ Não identificada' : 'Não informada'), inline: true },
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
