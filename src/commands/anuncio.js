const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anuncio')
    .setDescription('Envia um anúncio formatado em um canal')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption((opt) => opt.setName('canal').setDescription('Canal de destino').setRequired(true))
    .addStringOption((opt) => opt.setName('titulo').setDescription('Título do anúncio').setRequired(true))
    .addStringOption((opt) => opt.setName('mensagem').setDescription('Conteúdo do anúncio').setRequired(true)),

  async execute(interaction) {
    const canal = interaction.options.getChannel('canal');
    const titulo = interaction.options.getString('titulo');
    const mensagem = interaction.options.getString('mensagem');

    const embed = new EmbedBuilder()
      .setTitle(titulo)
      .setDescription(mensagem)
      .setColor(0x3498db)
      .setFooter({ text: `Anunciado por ${interaction.user.username}` })
      .setTimestamp();

    await canal.send({ embeds: [embed] });
    return interaction.reply({ content: `Anúncio enviado em ${canal}.`, ephemeral: true });
  },
};
