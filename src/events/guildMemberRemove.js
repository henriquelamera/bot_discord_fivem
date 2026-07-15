const { EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    const config = await serverService.getConfig(member.guild.id);
    const canalSaidasId = config.boas_vindas?.canal_saidas_id;

    // Registrar saída no canal
    if (canalSaidasId) {
      const canalSaidas = member.guild.channels.cache.get(canalSaidasId);
      if (canalSaidas) {
        const mensagemSaida = (config.boas_vindas?.mensagem_saida || `${member.user.tag} saiu do servidor.`)
          .replace(/\{usuario\}/g, member.user.tag)
          .replace(/\{servidor\}/g, member.guild.name);

        const embed = new EmbedBuilder()
          .setTitle('👋 Membro Saiu')
          .setColor(0xFF6B6B)
          .setDescription(mensagemSaida)
          .addFields(
            { name: '👤 Usuário', value: member.user.tag, inline: true },
            { name: 'ID', value: member.id, inline: true },
            { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
            { name: '⏰ Hora', value: new Date().toLocaleTimeString('pt-BR'), inline: true }
          )
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: `ID do Discord: ${member.id}` })
          .setTimestamp();

        await canalSaidas.send({ embeds: [embed] }).catch((err) => {
          console.error(`❌ Erro ao registrar saída:`, err.message);
        });
      }
    }

    // Deletar canal privado de farm (pela permissão da pessoa, não pelo nome)
    const categoria_bau_id = config.farm?.categoria_bau_id;
    if (categoria_bau_id) {
      try {
        const categoria = member.guild.channels.cache.get(categoria_bau_id);
        const canal = categoria?.children.cache.find((ch) => ch.permissionOverwrites.cache.has(member.id));
        if (canal) {
          await canal.delete();
          console.log(`✅ Canal de farm #${canal.name} deletado para ${member.user.tag}`);
        }
      } catch (err) {
        console.warn(`⚠️ Erro ao deletar canal de farm:`, err.message);
      }
    }

    // Limpar registros pendentes/temporários da pessoa
    let precisaSalvar = false;
    if (config.membros_info?.[member.id]) {
      delete config.membros_info[member.id];
      precisaSalvar = true;
    }
    if (config.atualizacoes_pendentes?.[member.id]) {
      delete config.atualizacoes_pendentes[member.id];
      precisaSalvar = true;
    }
    if (config.registros_pendentes?.[member.id]) {
      delete config.registros_pendentes[member.id];
      precisaSalvar = true;
    }
    if (config.atualizacoes_hierarquia_pendentes?.[member.id]) {
      delete config.atualizacoes_hierarquia_pendentes[member.id];
      precisaSalvar = true;
    }

    if (precisaSalvar) {
      await serverService.saveConfig(member.guild.id, config);
      console.log(`✅ Registros pendentes de ${member.user.tag} removidos ao sair do servidor`);
    }
  },
};
