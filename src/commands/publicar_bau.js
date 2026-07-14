const { SlashCommandBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');
const { embedFactories, rowFactory } = require('../utils/componentFactory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_bau')
    .setDescription('📦 Publicar botão de Abrir Baú no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalBauId = config.farm?.canal_bau_id;

    const embed = embedFactories.bauMenu();
    const row = rowFactory.bau();

    await publishMessage(interaction, canalBauId, 'Canal de Abrir Baú', embed, [row]);
  },
};
