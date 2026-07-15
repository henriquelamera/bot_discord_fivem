const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');
const { rowFactory } = require('../utils/componentFactory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_adv')
    .setDescription('⚠️ Publicar botões de ADV no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalAdvId = config.farm?.canal_registro_adv;

    // Criar embed com imagem/GIF se configurado
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Sistema de ADVs')
      .setColor(0xFF6B6B)
      .setDescription('Use os botões abaixo para registrar ou remover advertências:\n\n**⚠️ Registrar ADV** - Adicionar uma advertência a um membro\n**✅ Remover ADV** - Remover uma advertência de um membro');

    // Adicionar imagem/GIF se existir na config
    if (config.farm?.adv_imagem_url || config.farm?.adv_banner_url) {
      const imageUrl = config.farm.adv_imagem_url || config.farm.adv_banner_url;
      embed.setImage(imageUrl);
    }

    const row = rowFactory.advs();

    await publishMessage(interaction, canalAdvId, 'Canal de Registro de ADV', embed, [row]);
  },
};
