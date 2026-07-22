// Guarda o recrutador escolhido no menu de seleção enquanto a pessoa
// preenche o modal de registro em seguida (duas interações separadas -
// mesmo padrão do entregaMetaTracker). Expira sozinho pra não deixar lixo
// se a pessoa fechar o modal no meio do caminho.
const TTL_MS = 10 * 60 * 1000;
const recrutadorEscolhido = new Map();

function salvarRecrutador(userId, recrutadorId) {
  recrutadorEscolhido.set(userId, { recrutadorId, expiraEm: Date.now() + TTL_MS });
}

function pegarRecrutador(userId) {
  const registro = recrutadorEscolhido.get(userId);
  if (!registro) return null;
  if (Date.now() > registro.expiraEm) {
    recrutadorEscolhido.delete(userId);
    return null;
  }
  return registro.recrutadorId;
}

function limparRecrutador(userId) {
  recrutadorEscolhido.delete(userId);
}

module.exports = { salvarRecrutador, pegarRecrutador, limparRecrutador };
