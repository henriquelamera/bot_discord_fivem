const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_adv')
    .setDescription('⚠️ Publicar botões de ADV no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    const config = await serverService.getConfig(interaction.guild.id);
    const canalAdvId = config.farm?.canal_registro_adv;

    if (!canalAdvId) {
      return await interaction.reply({
        content: '❌ Canal de Registro de ADV não foi configurado!',
        ephemeral: true,
      });
    }

    const canalAdv = interaction.guild.channels.cache.get(canalAdvId);
    if (!canalAdv) {
      return await interaction.reply({
        content: '❌ Canal de Registro de ADV não encontrado!',
        ephemeral: true,
      });
    }

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

    try {
      await canalAdv.send({
        embeds: [embed],
        components: [row],
      });

      await interaction.reply({
        content: `✅ Botões de ADV publicados em <#${canalAdvId}>!`,
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
