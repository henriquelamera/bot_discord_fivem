const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel_configuracao')
    .setDescription('⚙️ Painel de Configuração do Servidor')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Painel de Configuração')
      .setDescription('Selecione a categoria que deseja configurar:')
      .setColor(0x3498db);

    const botoes = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cat_boas_vindas')
        .setLabel('👋 Boas-vindas')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cat_registro')
        .setLabel('📋 Registro')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cat_farm')
        .setLabel('🌾 Farm')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cat_recrutamento')
        .setLabel('👥 Recrutamento')
        .setStyle(ButtonStyle.Primary)
    );

    const botoes2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cat_status')
        .setLabel('✅ Status')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('limpar_config_painel')
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
