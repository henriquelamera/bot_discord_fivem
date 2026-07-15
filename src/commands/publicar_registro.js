const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');
const { rowFactory } = require('../utils/componentFactory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_registro')
    .setDescription('📋 Publicar botões de Registro no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalRegistroId = config.boas_vindas?.canal_registro_id;

    // Criar embed com imagem/GIF se configurado
    const embed = new EmbedBuilder()
      .setTitle('📋 Registro')
      .setColor(0x3498db)
      .setDescription('Clique no botão correspondente:\n\n📋 **Pedir Registro** - Se é sua primeira vez\n🔄 **Atualizar Registro** - Se já foi aprovado anteriormente');

    // Adicionar imagem/GIF se existir na config
    if (config.boas_vindas?.imagem_url || config.boas_vindas?.banner_url) {
      const imageUrl = config.boas_vindas.imagem_url || config.boas_vindas.banner_url;
      embed.setImage(imageUrl);
    }

    const row = rowFactory.registro();

    await publishMessage(interaction, canalRegistroId, 'Canal de Registro', embed, [row]);
  },
};
