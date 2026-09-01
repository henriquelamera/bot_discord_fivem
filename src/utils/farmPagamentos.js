// Formata um valor em Real (ex: 18000 -> "R$ 18.000,00")
function formatarMoeda(valor) {
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "2026-08-17T..." -> "17/08" no horário de Brasília. Null se a data faltar
// ou for inválida.
function formatarDataCurta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
}

// Dada a config e uma lista de ids de entrega, descreve o que entra num card
// de fechamento com as datas visíveis:
//  - linhas:    ["#147 · 17/08", "#148 · 18/08", ...] (data = aprovação, cai
//               pra data de entrega se faltar, e some se não tiver nenhuma)
//  - intervalo: "17/08 a 24/08" (ou "17/08" se for um dia só, null se sem data)
// Serve pra quem paga bater o olho e ver se tem entrega velha pendurada
// junto com as da semana.
function descreverEntregasFechamento(config, entregaIds) {
  const entregas = config.farm?.entregas || [];
  const porId = new Map(entregas.map((e) => [String(e.id), e]));

  const linhas = [];
  const datas = [];
  for (const id of entregaIds) {
    const e = porId.get(String(id));
    const iso = e?.data_aprovacao || e?.data_entrega || null;
    const curta = formatarDataCurta(iso);
    linhas.push(curta ? `#${id} · ${curta}` : `#${id}`);
    if (iso) {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) datas.push(d);
    }
  }

  let intervalo = null;
  if (datas.length > 0) {
    datas.sort((a, b) => a - b);
    const ini = formatarDataCurta(datas[0].toISOString());
    const fim = formatarDataCurta(datas[datas.length - 1].toISOString());
    intervalo = ini === fim ? ini : `${ini} a ${fim}`;
  }

  return { linhas, intervalo };
}

// Junta as linhas num valor de campo de embed respeitando o limite de 1024
// caracteres do Discord - se estourar, corta e avisa quantas sobraram.
function montarValorCampoEntregas(linhas) {
  const txt = linhas.join('\n');
  if (txt.length <= 1024) return txt || '—';

  const acc = [];
  let len = 0;
  for (const l of linhas) {
    if (len + l.length + 1 > 960) break;
    acc.push(l);
    len += l.length + 1;
  }
  return `${acc.join('\n')}\n… +${linhas.length - acc.length} entrega(s)`;
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
  formatarDataCurta,
  descreverEntregasFechamento,
  montarValorCampoEntregas,
  calcularPagamentosPorMembro,
  agruparPendentesPorMembroComIds,
};
