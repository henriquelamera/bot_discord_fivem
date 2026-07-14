const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { load } = require('../store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_bau')
    .setDescription('📦 Publicar botão de Abrir Baú no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = load('config.json', {});
    const canalBauId = config.farm?.canal_bau_id;

    if (!canalBauId) {
      return await interaction.reply({
        content: '❌ Canal de Abrir Baú não foi configurado!',
        ephemeral: true,
      });
    }

    const canalBau = interaction.guild.channels.cache.get(canalBauId);
    if (!canalBau) {
      return await interaction.reply({
        content: '❌ Canal de Abrir Baú não encontrado!',
        ephemeral: true,
      });
    }

    const botaoAbrir = new ButtonBuilder()
      .setCustomId('abrir_bau')
      .setLabel('📦 Abrir Baú')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(botaoAbrir);

    const embed = new EmbedBuilder()
      .setTitle('📦 Abrir Baú')
      .setColor(0xFFD700)
      .setDescription('Clique no botão para abrir seu baú de farm!\n\nVocê receberá os cargos necessários e terá acesso ao seu canal privado de farm.');

    try {
      await canalBau.send({
        embeds: [embed],
        components: [row],
      });

      await interaction.reply({
        content: `✅ Botão de Abrir Baú publicado em <#${canalBauId}>!`,
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Erro ao publicar: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
