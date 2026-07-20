const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_fechamento_farm')
    .setDescription('🧾 Publicar botão de gerar fechamento de pagamento no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);
    const canalId = config.farm?.canal_fechamento_semanal_id || config.farm?.canal_controle_pagamento_id;

    if (!canalId) {
      return await interaction.editReply({
        content: '❌ Canal de Fechamento Semanal não foi configurado! Configure em Farm > Canal de Fechamento Semanal.',
      });
    }

    const canal = interaction.guild.channels.cache.get(canalId);
    if (!canal) {
      return await interaction.editReply({
        content: '❌ Canal de Fechamento Semanal não encontrado!',
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🧾 Fechamento de Pagamento de Farm')
      .setColor(0xf1c40f)
      .setDescription(
        'Clique no botão abaixo pra gerar, na hora, um card por pessoa com farm aprovado pendente de pagamento ' +
        '(itens, entregas incluídas e valor total), com botão pra confirmar o pagamento de tudo de uma vez.\n\n' +
        'O fechamento automático continua rodando toda segunda-feira à meia-noite - esse botão é só pra ver o ' +
        'andamento a qualquer momento, sem precisar esperar.\n\n' +
        'Cards já quitados ("Tudo Pago") ficam parados no canal - use **Limpar Cards Antigos** de vez em quando ' +
        'pra apagar tudo que já foi postado ali e começar do zero.'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ger_farm_fechamento_agora').setLabel('🧾 Gerar Fechamento Agora').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('limpar_fechamento_cards').setLabel('🧹 Limpar Cards Antigos').setStyle(ButtonStyle.Secondary)
    );

    try {
      await canal.send({ embeds: [embed], components: [row] });
      await interaction.editReply({ content: `✅ Botão de fechamento publicado em <#${canalId}>!` });
    } catch (err) {
      await interaction.editReply({ content: `❌ Erro ao publicar: ${err.message}` });
    }
  },
};
