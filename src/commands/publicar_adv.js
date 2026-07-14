const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_adv')
    .setDescription('⚠️ Publicar botões de ADV no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalAdvId = config.farm?.canal_registro_adv;

    const botaoRegistrar = new ButtonBuilder()
      .setCustomId('registrar_adv')
      .setLabel('⚠️ Registrar ADV')
      .setStyle(ButtonStyle.Danger);

    const botaoRemover = new ButtonBuilder()
      .setCustomId('remover_adv')
      .setLabel('✅ Remover ADV')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(botaoRegistrar, botaoRemover);

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Sistema de ADVs')
      .setColor(0xFF6B6B)
      .setDescription('Use os botões abaixo para registrar ou remover advertências:\n\n' +
        '**⚠️ Registrar ADV** - Adicionar uma advertência a um membro\n' +
        '**✅ Remover ADV** - Remover uma advertência de um membro');

    await publishMessage(interaction, canalAdvId, 'Canal de Registro de ADV', embed, [row]);
  },
};
