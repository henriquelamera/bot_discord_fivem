const { EmbedBuilder } = require('discord.js');
const { load, save } = require('../store');

const CONFIG_FILE = 'config.json';

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    const config = load(CONFIG_FILE, {});
    const canalSaidasId = config.boas_vindas?.canal_saidas_id;

    // Registrar saída no canal
    if (canalSaidasId) {
      const canalSaidas = member.guild.channels.cache.get(canalSaidasId);
      if (canalSaidas) {
        const embed = new EmbedBuilder()
          .setTitle('👋 Membro Saiu')
          .setColor(0xFF6B6B)
          .addFields(
            { name: '👤 Usuário', value: member.user.tag, inline: true },
            { name: 'ID', value: member.id, inline: true },
            { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
            { name: '⏰ Hora', value: new Date().toLocaleTimeString('pt-BR'), inline: true }
          )
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: `ID do Discord: ${member.id}` })
          .setTimestamp();

        await canalSaidas.send({ embeds: [embed] }).catch(err => {
          console.error(`❌ Erro ao registrar saída:`, err.message);
        });
      }
    }

    // Limpar registro da pessoa
    if (config.membros_info?.[member.id]) {
      delete config.membros_info[member.id];
      save(CONFIG_FILE, config);
      console.log(`✅ Registro de ${member.user.tag} removido ao sair do servidor`);
    }

    // Limpar atualizações pendentes
    if (config.atualizacoes_pendentes?.[member.id]) {
      delete config.atualizacoes_pendentes[member.id];
      save(CONFIG_FILE, config);
    }

    // Limpar registros pendentes
    if (config.registros_pendentes?.[member.id]) {
      delete config.registros_pendentes[member.id];
      save(CONFIG_FILE, config);
    }

    // Deletar canal privado de farm
    const nomeFormatado = config.membros_info?.[member.id]?.nomeFormatado;
    if (nomeFormatado) {
      const nomeCanal = nomeFormatado
        .toLowerCase()
        .replace(/[^a-z0-9-|]/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '');

      const categoria_bau_id = config.farm?.categoria_bau_id;
      if (categoria_bau_id) {
        try {
          const categoria = member.guild.channels.cache.get(categoria_bau_id);
          if (categoria) {
            const canal = member.guild.channels.cache.find(
              ch => ch.parent?.id === categoria_bau_id && ch.name === nomeCanal
            );
            if (canal) {
              await canal.delete();
              console.log(`✅ Canal de farm #${nomeCanal} deletado para ${member.user.tag}`);
            }
          }
        } catch (err) {
          console.warn(`⚠️ Erro ao deletar canal de farm:`, err.message);
        }
      }
    }
  },
};
