const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_ger_farm')
    .setDescription('📊 Publicar painel de gerenciamento/estatísticas de farm no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);
    const canalId = config.farm?.canal_gerenciamento_id;

    if (!canalId) {
      return await interaction.editReply({
        content: '❌ Canal de Gerenciamento não foi configurado! Configure em Farm > Canal de Gerenciamento.',
      });
    }

    const canal = interaction.guild.channels.cache.get(canalId);
    if (!canal) {
      return await interaction.editReply({
        content: '❌ Canal de Gerenciamento não encontrado!',
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 Painel de Gerenciamento de Farm')
      .setColor(0x3498db)
      .setDescription('Clique em um botão abaixo para ver as estatísticas atualizadas na hora (só você vê a resposta).');

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ger_farm_sem_bau').setLabel('👥 Sem Baú').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ger_farm_bau_aberto').setLabel('📦 Baú Aberto').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ger_farm_em_dia').setLabel('✅ Farm em Dia').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ger_farm_atrasado').setLabel('⏸️ Farm Atrasado').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ger_farm_adv').setLabel('⚠️ ADV Farm').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ger_farm_metas_semanal').setLabel('🎯 Metas (Semana)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ger_farm_metas_total').setLabel('📊 Metas (Total)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ger_farm_valor_semanal').setLabel('💰 Pago (Semana)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ger_farm_valor_total').setLabel('💵 Pago (Total)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ger_farm_pendente').setLabel('⏳ Pendente').setStyle(ButtonStyle.Danger)
    );

    try {
      await canal.send({ embeds: [embed], components: [row1, row2] });
      await interaction.editReply({ content: `✅ Painel de gerenciamento publicado em <#${canalId}>!` });
    } catch (err) {
      await interaction.editReply({ content: `❌ Erro ao publicar: ${err.message}` });
    }
  },
};
