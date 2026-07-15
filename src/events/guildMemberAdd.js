const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const serverService = require('../services/serverService');

async function atribuirVisitante(member, roleIds) {
  if (!roleIds || roleIds.length === 0) {
    console.warn('⚠️  Nenhum cargo visitante configurado.');
    return;
  }

  for (const roleId of roleIds) {
    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      console.warn(`⚠️  Cargo ${roleId} não encontrado.`);
      continue;
    }
    await member.roles.add(role).catch((err) => {
      console.error(`❌ Erro ao atribuir cargo ${role.name}:`, err.message);
    });
  }
}

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const config = await serverService.getConfig(member.guild.id);
    const boasVindas = config.boas_vindas;

    if (!boasVindas?.canal_id) {
      console.warn('⚠️ Boas-vindas não configuradas.');
      return;
    }

    // SEMPRE atribuir cargo visitante
    await atribuirVisitante(member, boasVindas.cargo_ids);

    const canal = member.guild.channels.cache.get(boasVindas.canal_id);
    if (!canal) return;

    const texto = boasVindas.texto || `Bem vindo(a) a ${member.guild.name}!`;

    const embed = new EmbedBuilder()
      .setTitle('👋 Bem-vindo(a)!')
      .setColor(0x2ecc71)
      .setDescription(`<@${member.id}>\n${texto}`)
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `ID do usuário: ${member.id}` })
      .setTimestamp();

    if (boasVindas.banner_url) {
      embed.setImage(boasVindas.banner_url);
    }

    // SEMPRE enviar boas-vindas
    canal.send({ embeds: [embed] }).catch(err => {
      console.error(`❌ Erro ao enviar boas-vindas no canal #${canal.name}:`, err.message);
    });
  },
};
