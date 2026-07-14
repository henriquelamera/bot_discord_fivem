const { SlashCommandBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');
const { embedFactories, rowFactory } = require('../utils/componentFactory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_registro')
    .setDescription('📋 Publicar botões de Registro no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalRegistroId = config.boas_vindas?.canal_registro_id;

    const embed = embedFactories.registroMenu();
    const row = rowFactory.registro();

    await publishMessage(interaction, canalRegistroId, 'Canal de Registro', embed, [row]);
  },
};
