// Rastreia quais canais estão com um coletor de imagem ativo (alguém clicou
// em "Entregar Meta" e o bot está esperando a foto). Usado pra diferenciar
// uma foto que faz parte do fluxo de uma foto mandada sem clicar no botão.
const canaisAguardandoImagem = new Set();

function marcarAguardandoImagem(channelId) {
  canaisAguardandoImagem.add(channelId);
}

function desmarcarAguardandoImagem(channelId) {
  canaisAguardandoImagem.delete(channelId);
}

function estaAguardandoImagem(channelId) {
  return canaisAguardandoImagem.has(channelId);
}

module.exports = {
  marcarAguardandoImagem,
  desmarcarAguardandoImagem,
  estaAguardandoImagem,
};
