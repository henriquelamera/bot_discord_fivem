const { EmbedBuilder, ActionRowBuilder } = require('discord.js');

// Função genérica para publicar mensagens em canais
async function publishMessage(interaction, configChannelId, configChannelName, embed, components) {
  // Validar ID do canal
  if (!configChannelId) {
    return await interaction.reply({
      content: `❌ ${configChannelName} não foi configurado!`,
      ephemeral: true,
    });
  }

  // Pegar canal do cache
  const channel = interaction.guild.channels.cache.get(configChannelId);
  if (!channel) {
    return await interaction.reply({
      content: `❌ ${configChannelName} não encontrado!`,
      ephemeral: true,
    });
  }

  try {
    await channel.send({
      embeds: [embed],
      components,
    });

    await interaction.reply({
      content: `✅ Mensagem publicada em <#${configChannelId}>!`,
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({
      content: `❌ Erro ao publicar: ${err.message}`,
      ephemeral: true,
    });
  }
}

module.exports = {
  publishMessage,
};
