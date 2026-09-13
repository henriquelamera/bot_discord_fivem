// Converte texto de preço digitado por uma pessoa pra número, no padrão
// brasileiro (ponto = separador de milhar, vírgula = decimal). "74.000"
// vira 74000, não 74 - o parseFloat puro (JS/EUA) entende ponto como
// decimal e cortaria pra 74.00, exatamente o bug que gerou essa função.
//
// Fica num util próprio porque tanto os modais do Discord quanto o painel
// web de produtos precisam entender preço do mesmo jeito - duas cópias
// divergindo é como preço errado entra na calculadora.
function parsePrecoBR(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return NaN;

  const temVirgula = t.includes(',');
  const temPonto = t.includes('.');

  let normalizado = t;

  if (temVirgula) {
    // Vírgula presente = é o separador decimal; qualquer ponto antes dela
    // é separador de milhar ("74.000,50" -> "74000.50")
    normalizado = t.replace(/\./g, '').replace(',', '.');
  } else if (temPonto) {
    // Só ponto, sem vírgula: ambíguo. Se todo grupo depois de um ponto tem
    // exatamente 3 dígitos, é separador de milhar ("74.000" -> 74000,
    // "1.234.567" -> 1234567). Senão, é decimal normal ("74.50" -> 74.5).
    const partes = t.split('.');
    const pareceMilhar = partes.length > 1 && partes.slice(1).every((p) => p.length === 3);
    if (pareceMilhar) normalizado = t.replace(/\./g, '');
  }

  // Só aceita número puro. Sem isso o parseFloat para no primeiro caractere
  // estranho e devolve um preço plausível porém errado, calado: "150k" virava
  // 150 e "150 000" virava 150 - cobrança mil vezes menor sem ninguém notar.
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return NaN;

  return parseFloat(normalizado);
}

// Nome comparável pra detectar o mesmo produto escrito de formas diferentes:
// "AK-47", "ak 47" e "AK47" viram todos "ak47". Foi assim que a calculadora
// acabou com duas linhas da mesma arma, cada uma com um preço.
function normalizarNomeProduto(nome) {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

module.exports = { parsePrecoBR, normalizarNomeProduto };
