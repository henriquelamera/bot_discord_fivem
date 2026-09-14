// Correcao pontual JA APLICADA em 14/09/2026 - fica no repo como registro.
//
// O QUE ACONTECEU: na semana de 07 a 13/09/2026 um membro fechou R$ 142.200
// num teto de R$ 90.000 (2000 un. por item x 3 itens x R$ 15). As entregas
// #232 e #233 nasceram com 25ms de diferenca e com o MESMO print_url: o
// formulario de entrega foi preenchido duas vezes sem mandar foto no meio,
// os dois coletores ficaram ouvindo o mesmo canal e a unica foto enviada
// fechou os dois. Como o teto era calculado no envio do formulario, ambos
// calcularam em cima do mesmo saldo (1160 un.) e pagaram 1160 cada, ou seja
// 1160 x 3 itens x R$ 15 = R$ 52.200 a mais.
//
// O QUE ESTE SCRIPT FEZ: zerou o pagamento da #233 (a entrega continua
// registrada com o print, so nao e paga - igual a qualquer entrega acima do
// teto) e tirou ela do lote de fechamento, deixando a semana em R$ 90.000.
//
// A CAUSA foi corrigida no commit 6cfe7a3: trava pra nao abrir duas entregas
// esperando foto no mesmo canal + recalculo do teto na hora de gravar.
//
// Rodar de novo nao faz nada: as conferencias do inicio abortam porque a
// #233 ja nao tem pagamento. Sem --aplicar, e so simulacao.
require('dotenv').config();
const fs = require('fs');
const serverService = require('../services/serverService');
const pool = require('../db');

const GUILD_ID = '779539216195518484';
const ALVO = 233;
const APLICAR = process.argv.includes('--aplicar');
const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

(async () => {
  const config = await serverService.getConfig(GUILD_ID);

  // Backup da config inteira antes de qualquer escrita
  const backup = require('path').join(require('os').tmpdir(), 'backup-config-farm-' + Date.now() + '.json');
  fs.writeFileSync(backup, JSON.stringify(config, null, 2));
  console.log('backup salvo em: ' + backup + '  (' + fs.statSync(backup).size + ' bytes)\n');

  const entregas = config.farm?.entregas || [];
  const e233 = entregas.find((e) => Number(e.id) === ALVO);
  const e232 = entregas.find((e) => Number(e.id) === 232);
  if (!e233) throw new Error('entrega 233 nao encontrada');

  // Conferencias de seguranca antes de mexer
  console.log('CONFERENCIAS:');
  const checks = [
    ['#233 tem pagamento', !!e233.pagamento],
    ['#233 ainda PENDENTE (nao pago)', e233.pagamento?.status === 'pendente'],
    ['#233 vale 52.200', e233.pagamento?.valor_total === 52200],
    ['#233 e #232 tem o MESMO print', !!e232 && e233.print_url === e232.print_url],
  ];
  for (const [nome, ok] of checks) console.log('  ' + (ok ? 'OK  ' : 'NAO ') + nome);
  if (checks.some(([, ok]) => !ok)) throw new Error('alguma conferencia falhou - nada foi alterado');

  // Fechamentos pendentes que citam a #233
  const fechamentos = config.farm?.fechamentos_pendentes || {};
  console.log('\nFECHAMENTOS PENDENTES QUE CITAM A #233:');
  for (const [batchId, lote] of Object.entries(fechamentos)) {
    if (!lote.entregaIds.some((id) => String(id) === String(ALVO))) continue;
    console.log('  lote ' + batchId + ' | membro ' + lote.discordId + ' | entregas ' + lote.entregaIds.join(',') + ' | total ' + fmt(lote.valorTotal));
  }

  if (!APLICAR) { console.log('\n(simulacao - rode com --aplicar para gravar)'); await pool.end(); return; }

  // 1) tira a #233 dos fechamentos pendentes e abate o valor
  for (const lote of Object.values(fechamentos)) {
    const idx = lote.entregaIds.findIndex((id) => String(id) === String(ALVO));
    if (idx === -1) continue;
    lote.entregaIds.splice(idx, 1);
    lote.valorTotal -= e233.pagamento.valor_total || 0;
  }

  // 2) zera o pagamento da #233 - a entrega continua registrada, so nao e
  //    paga, igual acontece com qualquer entrega acima do teto semanal
  for (const dados of Object.values(e233.itens || {})) dados.quantidade_pagavel = 0;
  delete e233.pagamento;
  e233.correcao = {
    motivo: 'Entrega duplicada: mesmo print da #232, gravada 25ms depois por dois formularios aguardando a mesma foto. O teto semanal de 2000/item ja tinha sido fechado pela #232.',
    valor_estornado: 52200,
    data: new Date().toISOString(),
  };

  await serverService.saveConfig(GUILD_ID, config);
  console.log('\nGRAVADO.');

  // 3) confere o resultado relendo do banco
  const conf2 = await serverService.getConfig(GUILD_ID);
  const ent2 = conf2.farm.entregas.filter((e) => e.usuario_id === e233.usuario_id);
  let soma = 0;
  const porItem = {};
  for (const e of ent2) {
    const iso = e.data_entrega || '';
    if (iso < '2026-09-07' || iso > '2026-09-14') continue;
    for (const d of Object.values(e.itens || {})) {
      porItem[d.nome] = (porItem[d.nome] || 0) + (d.quantidade_pagavel ?? d.quantidade);
    }
    if (e.pagamento) soma += e.pagamento.valor_total || 0;
  }
  console.log('\nDEPOIS DA CORRECAO (semana 07/09-13/09):');
  for (const [nome, q] of Object.entries(porItem)) console.log('  ' + nome.padEnd(22) + 'pago ' + q + ' un.' + (q > 2000 ? '  <<< AINDA ACIMA' : ''));
  console.log('  TOTAL A PAGAR: ' + fmt(soma));
  for (const [batchId, lote] of Object.entries(conf2.farm.fechamentos_pendentes || {})) {
    console.log('  lote ' + batchId + ' -> entregas ' + lote.entregaIds.join(',') + ' | ' + fmt(lote.valorTotal));
  }
  await pool.end();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
