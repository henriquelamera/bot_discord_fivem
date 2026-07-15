const serverService = require('../services/serverService');
const { estaAguardandoImagem } = require('../utils/entregaMetaTracker');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.attachments.size === 0) return;

    const temImagem = [...message.attachments.values()].some((att) => att.contentType?.startsWith('image/'));
    if (!temImagem) return;

    // Já tem um coletor esperando essa imagem (fluxo correto em andamento)? Ignora.
    if (estaAguardandoImagem(message.channel.id)) return;

    try {
      const config = await serverService.getConfig(message.guild.id);
      const categoriaBauId = config.farm?.categoria_bau_id;
      if (!categoriaBauId) return;

      // É o canal privado de farm do próprio autor? (filho da categoria de
      // baú + permissão específica dele nesse canal)
      const ehCanalPrivadoDoAutor =
        message.channel.parentId === categoriaBauId &&
        message.channel.permissionOverwrites.cache.has(message.author.id);

      if (!ehCanalPrivadoDoAutor) return;

      await message.reply({
        content: '⚠️ Essa imagem sozinha **não conta como entrega**! Clique no botão **📦 Entregar Meta** aqui em cima, preencha as quantidades no formulário e só **depois** envie a foto quando o bot pedir.',
      });
    } catch (err) {
      console.error('Erro ao verificar imagem fora do fluxo de entrega:', err.message);
    }
  },
};
