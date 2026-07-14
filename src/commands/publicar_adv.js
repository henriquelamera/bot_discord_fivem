const { SlashCommandBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');
const { embedFactories, rowFactory } = require('../utils/componentFactory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_adv')
    .setDescription('⚠️ Publicar botões de ADV no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalAdvId = config.farm?.canal_registro_adv;

    const embed = embedFactories.advMenu();
    const row = rowFactory.advs();

    await publishMessage(interaction, canalAdvId, 'Canal de Registro de ADV', embed, [row]);
  },
};
