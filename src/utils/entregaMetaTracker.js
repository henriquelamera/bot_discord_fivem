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

// Guarda os itens já preenchidos enquanto o formulário de entrega é
// paginado (mais de 5 itens cadastrados = mais de um modal em sequência).
// Expira sozinho pra não deixar lixo se a pessoa fechar o modal no meio.
const ITENS_PARCIAIS_TTL_MS = 10 * 60 * 1000;
const itensParciaisEntrega = new Map();

function salvarItensParciais(userId, itens) {
  itensParciaisEntrega.set(userId, { itens, expiraEm: Date.now() + ITENS_PARCIAIS_TTL_MS });
}

function pegarItensParciais(userId) {
  const registro = itensParciaisEntrega.get(userId);
  if (!registro) return {};
  if (Date.now() > registro.expiraEm) {
    itensParciaisEntrega.delete(userId);
    return {};
  }
  return registro.itens;
}

function limparItensParciais(userId) {
  itensParciaisEntrega.delete(userId);
}

module.exports = {
  marcarAguardandoImagem,
  desmarcarAguardandoImagem,
  estaAguardandoImagem,
  salvarItensParciais,
  pegarItensParciais,
  limparItensParciais,
};
