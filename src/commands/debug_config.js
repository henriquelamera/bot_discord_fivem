const { SlashCommandBuilder } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug_config')
    .setDescription('🔍 Ver a config salva no banco de dados')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);

    // Mostrar a config inteira em formato legível
    const configStr = JSON.stringify(config, null, 2);

    // Se for muito grande, cortar
    const truncated = configStr.length > 2000
      ? configStr.substring(0, 1997) + '...'
      : configStr;

    await interaction.editReply({
      content: `\`\`\`json\n${truncated}\n\`\`\``,
    });
  },
};
