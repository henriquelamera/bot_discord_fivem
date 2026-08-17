const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_parcerias')
    .setDescription('🤝 Publicar botão de registrar parceria no canal atual')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);
    const cargoRegistrarIds = config.parcerias?.cargo_registrar_ids || [];
    const categoriaProdutosId = config.parcerias?.categoria_produtos_id;

    if (cargoRegistrarIds.length === 0 || !categoriaProdutosId) {
      return await interaction.editReply({
        content: '❌ Configure primeiro em Parcerias: Cargos que Podem Registrar e Categoria de Produtos (`/painel_configuracao`).',
      });
    }

    const categoria = interaction.guild.channels.cache.get(categoriaProdutosId);

    const embed = new EmbedBuilder()
      .setTitle('🤝 Registrar Parceria')
      .setColor(0x3498db)
      .setDescription(
        'Clique no botão abaixo pra registrar uma nova parceria.\n\n' +
        '**Etapa 1:** Selecione o produto da parceria.\n' +
        '**Etapa 2:** Preencha o formulário (responsável da outra facção, nome da facção, darkchat, senha).\n' +
        '**Etapa 3:** Envie o print da parceria (roupa da facção).\n' +
        '**Etapa 4:** Envie o print do mapa (localização da facção).\n\n' +
        `A parceria é publicada automaticamente no canal do produto escolhido, dentro de ${categoria ? categoria.name : 'da categoria configurada'}.`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('registrar_parceria').setLabel('🤝 Registrar Parceria').setStyle(ButtonStyle.Primary)
    );

    try {
      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.editReply({ content: '✅ Botão de registrar parceria publicado!' });
    } catch (err) {
      await interaction.editReply({ content: `❌ Erro ao publicar: ${err.message}` });
    }
  },
};
