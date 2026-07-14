const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin_bot')
    .setDescription('⚙️ Painel do Administrador (APENAS ADMIN)')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Painel do Administrador')
      .setDescription('Selecione a categoria que deseja configurar:')
      .setColor(0x3498db);

    const botoes = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cat_credenciais')
        .setLabel('🔧 Credenciais')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cat_cargos')
        .setLabel('🔴 Cargos Bot')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cat_cargos_sistema')
        .setLabel('⭐ Cargos Sistema')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cat_cargos_farm')
        .setLabel('🌾 Cargos Farm')
        .setStyle(ButtonStyle.Primary)
    );

    const botoes2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cat_status_admin')
        .setLabel('✅ Status')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('limpar_config_bot_ids')
        .setLabel('🗑️ Limpar IDs')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('limpar_config_admin_menu')
        .setLabel('🗑️ Limpar Configurações')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      embeds: [embed],
      components: [botoes, botoes2],
      ephemeral: true,
    });
  },
};
