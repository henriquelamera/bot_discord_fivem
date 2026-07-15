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

    await canal.send({ embeds: [embedCard], components: [row] });
  }

  await serverService.saveConfig(guild.id, config);

  return { posted: true, quantidade: pendentes.length, totalGeral, canalId };
}

module.exports = { postarFechamentoSemanal };
