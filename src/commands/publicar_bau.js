const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_bau')
    .setDescription('📦 Publicar botão de Abrir Baú no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalBauId = config.farm?.canal_bau_id;

    const botaoAbrir = new ButtonBuilder()
      .setCustomId('abrir_bau')
      .setLabel('📦 Abrir Baú')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(botaoAbrir);

    const embed = new EmbedBuilder()
      .setTitle('📦 Abrir Baú')
      .setColor(0xFFD700)
      .setDescription('Clique no botão para abrir seu baú de farm!\n\nVocê receberá os cargos necessários e terá acesso ao seu canal privado de farm.');

    await publishMessage(interaction, canalBauId, 'Canal de Abrir Baú', embed, [row]);
  },
};
