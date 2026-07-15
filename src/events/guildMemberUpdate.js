const serverService = require('../services/serverService');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    const config = await serverService.getConfig(newMember.guild.id);
    const moradorRoleId = config.cargo_morador_id;

    if (!moradorRoleId) return;

    // Verificar se o cargo "Morador" foi adicionado
    const hadMoradorRole = oldMember.roles.cache.has(moradorRoleId);
    const hasMoradorRole = newMember.roles.cache.has(moradorRoleId);

    if (!hadMoradorRole && hasMoradorRole) {
      // Cargo foi adicionado, mas agora apenas o evento guildMemberUpdate registra
      // O parabéns e criação de canal privado virão do botão "Abrir Baú"
      console.log(`✅ ${newMember.user.tag} recebeu o cargo de Morador`);
    }
  },
};
