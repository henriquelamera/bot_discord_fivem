const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const serverService = require('../services/serverService');
const { formatarMoeda, agruparPendentesPorMembroComIds } = require('./farmPagamentos');

// Gera e posta o fechamento de pagamentos (um card por pessoa com pendência
// + botão de confirmar pagamento em lote) no canal configurado. Usado tanto
// pelo cron de toda segunda quanto por um botão manual, pra dar uma visão
// de como tá o pagamento a qualquer momento (não só no fechamento oficial).
async function postarFechamentoSemanal(guild, config) {
  const canalId = config.farm?.canal_fechamento_semanal_id || config.farm?.canal_controle_pagamento_id;
  const canal = canalId ? guild.channels.cache.get(canalId) : null;

  if (!canal) {
    return { posted: false, motivo: 'canal_nao_configurado' };
  }

  const pendentes = agruparPendentesPorMembroComIds(config);
  if (pendentes.length === 0) {
    return { posted: false, motivo: 'sem_pendencias' };
  }

  if (!config.farm.fechamentos_pendentes) config.farm.fechamentos_pendentes = {};

  const totalGeral = pendentes.reduce((soma, m) => soma + m.total, 0);
  await canal.send({
    content: `🧾 **Fechamento de Farm** — total a pagar até agora: **${formatarMoeda(totalGeral)}** (${pendentes.length} pessoa(s))`,
  });

  for (const membro of pendentes) {
    const batchId = `${Date.now()}_${membro.discordId}`;

    config.farm.fechamentos_pendentes[batchId] = {
      discordId: membro.discordId,
      entregaIds: membro.entregaIds,
      valorTotal: membro.total,
      data: new Date().toISOString(),
    };

    const embedCard = new EmbedBuilder()
      .setTitle('💰 Pagamento Pendente — Fechamento')
      .setColor(0xf1c40f)
      .addFields(
        { name: '👤 Farmou', value: `<@${membro.discordId}>`, inline: false },
        { name: '🧾 Entregas Incluídas', value: membro.entregaIds.map((id) => `#${id}`).join(', '), inline: false },
        { name: '💵 Valor Total', value: formatarMoeda(membro.total), inline: false }
      )
      .setTimestamp();

    const botaoConfirmar = new ButtonBuilder()
      .setCustomId(`confirmar_pagamento_semanal_${batchId}`)
      .setLabel('✅ Confirmar Pagamento')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(botaoConfirmar);

    const mensagemCard = await canal.send({ embeds: [embedCard], components: [row] });
    config.farm.fechamentos_pendentes[batchId].canal_id = canal.id;
    config.farm.fechamentos_pendentes[batchId].mensagem_id = mensagemCard.id;
  }

  await serverService.saveConfig(guild.id, config);

  return { posted: true, quantidade: pendentes.length, totalGeral, canalId };
}

// Quando uma entrega é marcada como paga (individualmente ou em lote), tira
// ela de qualquer card de fechamento pendente que ainda a referencie e
// atualiza o card (valor + lista de entregas) - ou marca "tudo pago" se
// não sobrar nenhuma. Só mexe em `config` na memória, quem chama salva.
async function removerEntregaDosFechamentosPendentes(guild, config, entrega) {
  const fechamentos = config.farm?.fechamentos_pendentes;
  if (!fechamentos) return;

  for (const [batchId, lote] of Object.entries(fechamentos)) {
    const idx = lote.entregaIds.findIndex((id) => String(id) === String(entrega.id));
    if (idx === -1) continue;

    lote.entregaIds.splice(idx, 1);
    lote.valorTotal -= entrega.pagamento.valor_total || 0;

    if (!lote.canal_id || !lote.mensagem_id) continue;

    try {
      const canal = guild.channels.cache.get(lote.canal_id);
      const msg = await canal?.messages.fetch(lote.mensagem_id);
      if (!msg) continue;

      const embedAtual = msg.embeds[0];

      if (lote.entregaIds.length === 0) {
        const embedPago = EmbedBuilder.from(embedAtual)
          .setColor(0x2ecc71)
          .setTitle('✅ Tudo Pago');
        await msg.edit({ embeds: [embedPago], components: [] });
        delete fechamentos[batchId];
      } else {
        const embedAtualizado = EmbedBuilder.from(embedAtual).setFields(
          { name: '👤 Farmou', value: `<@${lote.discordId}>`, inline: false },
          { name: '🧾 Entregas Incluídas', value: lote.entregaIds.map((id) => `#${id}`).join(', '), inline: false },
          { name: '💵 Valor Total', value: formatarMoeda(lote.valorTotal), inline: false }
        );
        await msg.edit({ embeds: [embedAtualizado] });
      }
    } catch (err) {
      console.warn('Não foi possível atualizar card de fechamento após pagamento:', err.message);
    }
  }
}

module.exports = { postarFechamentoSemanal, removerEntregaDosFechamentosPendentes };
