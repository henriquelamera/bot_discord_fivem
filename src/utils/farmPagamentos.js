// Formata um valor em Real (ex: 18000 -> "R$ 18.000,00")
function formatarMoeda(valor) {
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Agrupa pagamentos de config.farm.entregas por usuário, somando o valor e
// contando quantos pagamentos cada um teve. `filtro` recebe o objeto
// `pagamento` de cada entrega e decide se ele entra na conta (ex: só
// "pago" na semana, ou só "pendente"). Retorna ordenado do maior pro menor.
function calcularPagamentosPorMembro(config, filtro) {
  const entregas = config.farm?.entregas || [];
  const porMembro = new Map();

  for (const entrega of entregas) {
    const pagamento = entrega.pagamento;
    if (!pagamento || !filtro(pagamento)) continue;

    const atual = porMembro.get(entrega.usuario_id) || { total: 0, qtd: 0 };
    atual.total += pagamento.valor_total || 0;
    atual.qtd++;
    porMembro.set(entrega.usuario_id, atual);
  }

  return [...porMembro.entries()]
    .map(([discordId, dados]) => ({ discordId, ...dados }))
    .sort((a, b) => b.total - a.total);
}

// Agrupa entregas com pagamento pendente por usuário, trazendo também os
// ids das entregas incluídas (não só o total) - usado no fechamento semanal
// pra poder confirmar o pagamento de tudo de uma vez.
function agruparPendentesPorMembroComIds(config) {
  const entregas = config.farm?.entregas || [];
  const porMembro = new Map();

  for (const entrega of entregas) {
    const pagamento = entrega.pagamento;
    if (!pagamento || pagamento.status !== 'pendente') continue;

    const atual = porMembro.get(entrega.usuario_id) || { total: 0, entregaIds: [] };
    atual.total += pagamento.valor_total || 0;
    atual.entregaIds.push(entrega.id);
    porMembro.set(entrega.usuario_id, atual);
  }

  return [...porMembro.entries()]
    .map(([discordId, dados]) => ({ discordId, ...dados }))
    .sort((a, b) => b.total - a.total);
}

module.exports = {
  formatarMoeda,
  calcularPagamentosPorMembro,
  agruparPendentesPorMembroComIds,
};
