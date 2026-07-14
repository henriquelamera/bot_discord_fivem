const { SlashCommandBuilder } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('definir_senha_painel')
    .setDescription('🔐 Definir senha para acessar painéis (APENAS ADMIN)')
    .setDefaultMemberPermissions(0x8) // ADMINISTRATOR
    .addStringOption(option =>
      option
        .setName('senha')
        .setDescription('Senha para acessar os painéis')
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(20)
    ),

  async execute(interaction) {
    // Verificar se é admin
    if (!interaction.memberPermissions.has('ADMINISTRATOR')) {
      return await interaction.reply({
        content: '❌ Apenas administradores podem definir a senha!',
        ephemeral: true,
      });
    }

    const senha = interaction.options.getString('senha');
    const guildId = interaction.guild.id;

    try {
      // Registrar servidor se não existir
      await serverService.registerServer(
        guildId,
        interaction.guild.name,
        interaction.guild.ownerId
      );

      // Salvar senha no banco (em config_servidor como JSON)
      const pool = require('../db');
      await pool.query(
        `INSERT INTO config_servidor (servidor_id, config_json)
         VALUES ((SELECT id FROM servidores WHERE guild_id = $1), $2)
         ON CONFLICT (servidor_id)
         DO UPDATE SET config_json = $2, data_atualizacao = NOW()`,
        [guildId, JSON.stringify({ senha_painel: senha })]
      );

      // Log
      await serverService.logAction(
        guildId,
        interaction.user.id,
        'definir_senha',
        `Senha do painel definida`
      );

      await interaction.reply({
        content: `🔐 Senha do painel definida com sucesso!\n\n**Senha:** \`${senha}\`\n\n(Não-admins precisarão desta senha para acessar os painéis)`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Erro ao definir senha:', error);
      await interaction.reply({
        content: `❌ Erro ao definir senha: ${error.message}`,
        ephemeral: true,
      });
    }
  },
};
