// Brasil não usa mais horário de verão desde 2019 - UTC-3 fixo o ano todo,
// então dá pra usar um offset simples em vez de uma lib de timezone.
const OFFSET_BRASILIA_MS = 3 * 60 * 60 * 1000;

// Retorna um Date cujos getters UTC (getUTCDay, getUTCHours etc.) refletem
// o horário de parede de Brasília agora, independente do fuso do processo
// que está rodando (Railway roda em UTC, por exemplo).
function agoraEmBrasiliaComoUTC() {
  return new Date(Date.now() - OFFSET_BRASILIA_MS);
}

// Início da semana de farm vigente (segunda-feira 00:00, horário de
// Brasília), como instante UTC real - usado tanto pro teto semanal de
// entrega quanto pro cron de ADV, pra não bater 3h adiantado (meia-noite em
// UTC é 21h de domingo em Brasília).
function inicioDaSemanaBrasilia() {
  const agora = agoraEmBrasiliaComoUTC();
  const diaDaSemana = agora.getUTCDay(); // 0=domingo, 1=segunda, ...
  const diasDesdeSegunda = (diaDaSemana + 6) % 7;
  const inicio = new Date(agora);
  inicio.setUTCDate(agora.getUTCDate() - diasDesdeSegunda);
  inicio.setUTCHours(0, 0, 0, 0);
  return new Date(inicio.getTime() + OFFSET_BRASILIA_MS);
}

module.exports = { agoraEmBrasiliaComoUTC, inicioDaSemanaBrasilia };
