// Material de farm desativado ("aposentado"): continua existindo no config,
// mas some do formulário de entrega e da cobrança de meta/ADV.
//
// Por que desativar em vez de excluir: o valor de uma entrega só é calculado
// na hora da APROVAÇÃO, lendo config.farm.pagamentos[itemId]. Apagar o item
// enquanto existe entrega esperando aprovação faria aquele material ser pago
// como zero, calado. Desativando, o pagamento continua de pé e a entrega
// antiga fecha certo - só não dá pra entregar mais nem leva ADV por ele.
//
// Item cadastrado antes desse campo existir não tem `ativo`, e vale como
// ativo - nenhuma configuração precisa ser migrada.
function itemAtivo(item) {
  return !!item && item.ativo !== false;
}

function itensAtivosFarm(config) {
  return (config.farm?.itens || []).filter(itemAtivo);
}

// Metas apenas dos materiais ainda ativos. É o que a cobrança de segunda
// usa: sem isso, material aposentado continuaria gerando ADV pra semana
// inteira da facção. Meta órfã (de item que não existe mais) também sai.
function metasAtivas(config) {
  const ativos = new Set(itensAtivosFarm(config).map((i) => i.id));
  const saida = {};
  for (const [id, meta] of Object.entries(config.farm?.metas || {})) {
    if (ativos.has(id)) saida[id] = meta;
  }
  return saida;
}

module.exports = { itemAtivo, itensAtivosFarm, metasAtivas };
