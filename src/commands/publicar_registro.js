const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_registro')
    .setDescription('📋 Publicar botões de Registro no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalRegistroId = config.boas_vindas?.canal_registro_id;

    const botaoPedir = new ButtonBuilder()
      .setCustomId('pedir_registro')
      .setLabel('📋 Pedir Registro')
      .setStyle(ButtonStyle.Primary);

    const botaoAtualizar = new ButtonBuilder()
      .setCustomId('atualizar_registro')
      .setLabel('🔄 Atualizar Registro')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(botaoPedir, botaoAtualizar);

    const embed = new EmbedBuilder()
      .setTitle('📋 Registro')
      .setColor(0x3498db)
      .setDescription('Clique no botão correspondente:\n\n📋 **Pedir Registro** - Se é sua primeira vez\n🔄 **Atualizar Registro** - Se já foi aprovado anteriormente');

    await publishMessage(interaction, canalRegistroId, 'Canal de Registro', embed, [row]);
  },
};
