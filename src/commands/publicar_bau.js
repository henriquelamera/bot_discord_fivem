const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');
const { rowFactory } = require('../utils/componentFactory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_bau')
    .setDescription('📦 Publicar botão de Abrir Baú no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    // Avisar ao Discord que vai processar (evita timeout)
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);
    const canalBauId = config.farm?.canal_bau_id;

    // Criar embed com imagem/GIF se configurado
    const embed = new EmbedBuilder()
      .setTitle('📦 Abrir Baú')
      .setColor(0xFFD700)
      .setDescription('Clique no botão para abrir seu baú de farm!\n\nVocê receberá os cargos necessários e terá acesso ao seu canal privado de farm.');

    // Adicionar imagem/GIF se existir na config
    if (config.farm?.imagem_url || config.farm?.banner_url) {
      const imageUrl = config.farm.imagem_url || config.farm.banner_url;
      embed.setImage(imageUrl);
    }

    const row = rowFactory.bau();

    // Validar canal
    if (!canalBauId) {
      return await interaction.editReply({
        content: '❌ Canal de Abrir Baú não foi configurado!',
      });
    }

    const canal = interaction.guild.channels.cache.get(canalBauId);
    if (!canal) {
      return await interaction.editReply({
        content: '❌ Canal de Abrir Baú não encontrado!',
      });
    }

    try {
      await canal.send({
        embeds: [embed],
        components: [row],
      });

      await interaction.editReply({
        content: `✅ Botão de Abrir Baú publicado em <#${canalBauId}>!`,
      });
    } catch (err) {
      await interaction.editReply({
        content: `❌ Erro ao publicar: ${err.message}`,
      });
    }
  },
};
