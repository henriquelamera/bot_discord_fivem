// Guarda o canal de produto escolhido no menu de seleção enquanto a pessoa
// preenche o modal de registro de parceria em seguida (duas interações
// separadas - mesmo padrão do registroTracker/entregaMetaTracker). Expira
// sozinho pra não deixar lixo se a pessoa fechar o modal no meio.
const TTL_MS = 10 * 60 * 1000;
const produtoEscolhido = new Map();

function salvarProdutoParceria(userId, canalId) {
  produtoEscolhido.set(userId, { canalId, expiraEm: Date.now() + TTL_MS });
}

function pegarProdutoParceria(userId) {
  const registro = produtoEscolhido.get(userId);
  if (!registro) return null;
  if (Date.now() > registro.expiraEm) {
    produtoEscolhido.delete(userId);
    return null;
  }
  return registro.canalId;
}

function limparProdutoParceria(userId) {
  produtoEscolhido.delete(userId);
}

module.exports = { salvarProdutoParceria, pegarProdutoParceria, limparProdutoParceria };
