const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { load, save } = require('../store');

const FILE = 'advertencias.json';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('advertencia')
    .setDescription('Aplica ou consulta advertências de membros')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) => sub
      .setName('aplicar')
      .setDescription('Aplica uma advertência a um membro')
      .addUserOption((opt) => opt.setName('membro').setDescription('Membro advertido').setRequired(true))
      .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo da advertência').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('consultar')
      .setDescription('Consulta as advertências de um membro')
      .addUserOption((opt) => opt.setName('membro').setDescription('Membro a consultar').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const advertencias = load(FILE, {});

    if (sub === 'aplicar') {
      const membro = interaction.options.getUser('membro');
      const motivo = interaction.options.getString('motivo');

      advertencias[membro.id] = advertencias[membro.id] || [];
      advertencias[membro.id].push({
        motivo,
        aplicadaPor: interaction.user.id,
        data: Date.now(),
      });
      save(FILE, advertencias);

      const total = advertencias[membro.id].length;
      const embed = new EmbedBuilder()
        .setTitle('Advertência aplicada')
        .setColor(0xf39c12)
        .addFields(
          { name: 'Membro', value: `<@${membro.id}>`, inline: true },
          { name: 'Total de advertências', value: `${total}`, inline: true },
          { name: 'Motivo', value: motivo },
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'consultar') {
      const membro = interaction.options.getUser('membro');
      const lista = advertencias[membro.id] || [];
      if (lista.length === 0) {
        return interaction.reply({ content: `<@${membro.id}> não possui advertências.`, ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setTitle(`Advertências de ${membro.username}`)
        .setColor(0xf39c12)
        .setDescription(lista.map((a, i) => `**${i + 1}.** ${a.motivo} — <t:${Math.floor(a.data / 1000)}:d>`).join('\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
