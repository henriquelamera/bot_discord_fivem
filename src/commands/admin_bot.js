const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin_bot')
    .setDescription('⚙️ Painel do Administrador (APENAS ADMIN)')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    // Verificar se é admin do servidor
    if (!interaction.memberPermissions.has('ADMINISTRATOR')) {
      // Verificar se tem senha configurada
      const temSenha = await serverService.getSenhaPainel(interaction.guild.id);

      if (!temSenha) {
        return await interaction.reply({
          content: '❌ Você precisa ser administrador do servidor para usar este comando!\n\n(Admin pode configurar uma senha com `/definir_senha_painel`)',
          ephemeral: true,
        });
      }

      // Pedir senha em modal
      const modal = new ModalBuilder()
        .setCustomId('modal_senha_admin_bot')
        .setTitle('🔐 Digite a Senha');

      const input = new TextInputBuilder()
        .setCustomId('senha_input')
        .setLabel('Senha do Painel')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Digite a senha')
        .setRequired(true);

      modal.addComponents(new (require('discord.js')).ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

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
        .setCustomId('cat_advs')
        .setLabel('⚠️ Sistema de ADVs')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cat_status_admin')
        .setLabel('✅ Status')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('limpar_config_bot_ids')
        .setLabel('🗑️ Limpar IDs')
        .setStyle(ButtonStyle.Danger)
    );

    const botoes3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('limpar_config_admin_menu')
        .setLabel('🗑️ Limpar Configurações')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      embeds: [embed],
      components: [botoes, botoes2, botoes3],
      ephemeral: true,
    });
  },
};
