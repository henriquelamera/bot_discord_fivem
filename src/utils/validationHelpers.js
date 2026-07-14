const serverService = require('../services/serverService');

// Validar que canal está configurado
async function validateChannelConfig(interaction, channelId, channelName) {
  if (!channelId) {
    await interaction.reply({
      content: `❌ ${channelName} não foi configurado!`,
      ephemeral: true,
    });
    return null;
  }

  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel) {
    await interaction.reply({
      content: `❌ ${channelName} não encontrado no servidor!`,
      ephemeral: true,
    });
    return null;
  }

  return channel;
}

// Validar que role está configurado
async function validateRoleConfig(interaction, roleId, roleName) {
  if (!roleId) {
    await interaction.reply({
      content: `❌ ${roleName} não foi configurado!`,
      ephemeral: true,
    });
    return null;
  }

  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    await interaction.reply({
      content: `❌ ${roleName} não encontrado no servidor!`,
      ephemeral: true,
    });
    return null;
  }

  return role;
}

// Validar que membro tem permissão
async function validateMemberHasRole(interaction, memberId, roleId) {
  const member = await interaction.guild.members.fetch(memberId).catch(() => null);
  if (!member) {
    return false;
  }

  return member.roles.cache.has(roleId);
}

// Validar que config section existe
async function validateConfigSection(interaction, config, sectionPath, sectionName) {
  const keys = sectionPath.split('.');
  let section = config;

  for (const key of keys) {
    section = section?.[key];
    if (!section) {
      await interaction.reply({
        content: `❌ ${sectionName} não foi configurado corretamente!`,
        ephemeral: true,
      });
      return null;
    }
  }

  return section;
}

module.exports = {
  validateChannelConfig,
  validateRoleConfig,
  validateMemberHasRole,
  validateConfigSection,
};
