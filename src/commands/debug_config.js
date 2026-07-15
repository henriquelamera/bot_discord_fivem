const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug_config')
    .setDescription('🔍 Ver a config salva no banco de dados')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);
    const configStr = JSON.stringify(config, null, 2);

    // Mensagens do Discord têm limite de 2000 caracteres; o bloco de código
    // (```json\n...\n```) soma ~10 caracteres extras a esse total.
    const LIMITE_MENSAGEM = 1900;

    if (configStr.length <= LIMITE_MENSAGEM) {
      await interaction.editReply({
        content: `\`\`\`json\n${configStr}\n\`\`\``,
      });
    } else {
      const arquivo = new AttachmentBuilder(Buffer.from(configStr, 'utf-8'), {
        name: `config_${interaction.guild.id}.json`,
      });

      await interaction.editReply({
        content: '🔍 Config muito grande para exibir no chat, segue em arquivo:',
        files: [arquivo],
      });
    }
  },
};
