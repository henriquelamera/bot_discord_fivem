const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { load, save } = require('../store');

const FILE = 'pontos.json';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ponto')
    .setDescription('Sistema de ponto da facção')
    .addSubcommand((sub) => sub.setName('entrar').setDescription('Bater ponto de entrada'))
    .addSubcommand((sub) => sub.setName('sair').setDescription('Bater ponto de saída'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Ver seu status de ponto')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const pontos = load(FILE, {});

    if (sub === 'entrar') {
      if (pontos[userId]?.entrada) {
        return interaction.reply({ content: 'Você já bateu ponto de entrada.', ephemeral: true });
      }
      pontos[userId] = { entrada: Date.now(), saida: null };
      save(FILE, pontos);
      return interaction.reply(`🟢 Ponto de entrada registrado para <@${userId}>.`);
    }

    if (sub === 'sair') {
      const registro = pontos[userId];
      if (!registro?.entrada) {
        return interaction.reply({ content: 'Você ainda não bateu ponto de entrada.', ephemeral: true });
      }
      registro.saida = Date.now();
      const duracaoMin = Math.round((registro.saida - registro.entrada) / 60000);
      pontos[userId] = { entrada: null, saida: null };
      save(FILE, pontos);
      return interaction.reply(`🔴 Ponto de saída registrado para <@${userId}>. Tempo online: ${duracaoMin} min.`);
    }

    if (sub === 'status') {
      const registro = pontos[userId];
      const embed = new EmbedBuilder()
        .setTitle('Status de Ponto')
        .setColor(registro?.entrada ? 0x2ecc71 : 0xe74c3c)
        .setDescription(registro?.entrada
          ? `Ponto aberto desde <t:${Math.floor(registro.entrada / 1000)}:R>`
          : 'Nenhum ponto em aberto.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
