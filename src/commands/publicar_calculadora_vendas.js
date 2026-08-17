const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_calculadora_vendas')
    .setDescription('🧮 Publicar botão da calculadora de vendas no canal atual')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);
    const produtos = config.vendas?.produtos || [];
    const cargoCalculadoraIds = config.vendas?.cargo_calculadora_ids || [];

    if (produtos.length === 0) {
      return await interaction.editReply({
        content: '❌ Nenhum produto cadastrado ainda. Configure em Vendas > Criar Produtos (`/painel_configuracao`).',
      });
    }

    if (cargoCalculadoraIds.length === 0) {
      return await interaction.editReply({
        content: '❌ Nenhum cargo configurado pra usar a calculadora. Configure em Vendas > Cargos que Podem Usar a Calculadora (`/painel_configuracao`).',
      });
    }

    const logo = new AttachmentBuilder(path.join(__dirname, '..', '..', 'img', 'RBK_bot_centralizado.gif'), {
      name: 'rbk_logo.gif',
    });

    const urlCalculadora = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;

    const embed = new EmbedBuilder()
      .setTitle('🧮 Calculadora de Vendas')
      .setColor(0x1a2332)
      .setThumbnail('attachment://rbk_logo.gif')
      .setDescription(
        'Clique no botão abaixo pra abrir a calculadora de vendas.\n\n' +
        'Lá você escolhe o produto, o tipo de venda (com ou sem parceria) e a quantidade, ' +
        'e já pode registrar a venda direto.'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🧮 Calculadora de Vendas').setStyle(ButtonStyle.Link).setURL(urlCalculadora)
    );

    try {
      await interaction.channel.send({ embeds: [embed], components: [row], files: [logo] });
      await interaction.editReply({ content: '✅ Botão da calculadora de vendas publicado!' });
    } catch (err) {
      await interaction.editReply({ content: `❌ Erro ao publicar: ${err.message}` });
    }
  },
};
