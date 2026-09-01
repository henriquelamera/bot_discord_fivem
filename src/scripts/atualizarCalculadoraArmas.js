// Atualiza a calculadora de vendas com os nomes e valores da imagem
// "RBK ARMA — VALORES" (armasrbk.png).
//
// Uso:  node src/scripts/atualizarCalculadoraArmas.js [guildId]
//       (sem argumento usa process.env.CALC_GUILD_ID ou process.env.GUILD_ID)
//
// É idempotente: casa cada arma com um produto já existente pelo nome
// (ignorando maiúsculas/espaços) e só cria quando não existe. Não apaga
// nenhum produto que já esteja cadastrado.

require('dotenv').config();
const serverService = require('../services/serverService');
const pool = require('../db');

const GUILD_ID = process.argv[2] || process.env.CALC_GUILD_ID || process.env.GUILD_ID;

// Coluna PARCERIA = preco_parceria | coluna PISTA = preco_pista
const ARMAS = [
  { nome: 'M4A1', parceria: 100000, pista: 120000 },
  { nome: 'AK47', parceria: 135000, pista: 162000 },
  { nome: 'M16', parceria: 148000, pista: 162000 },
  { nome: 'M4A4', parceria: 148000, pista: 177000 },
  { nome: 'G36', parceria: 160000, pista: 192000 },
  { nome: 'Sig Sauer', parceria: 160000, pista: 192000 },
  { nome: 'Evo', parceria: 90000, pista: 108000 },
  { nome: 'Tec-9', parceria: 75000, pista: 90000 },
  { nome: 'AP Pistol', parceria: 90000, pista: 108000 },
  { nome: 'Mtar', parceria: 110000, pista: 132000 },
];

(async () => {
  if (!GUILD_ID) throw new Error('Guild não informada (argumento, CALC_GUILD_ID ou GUILD_ID no .env)');
  console.log(`Guild alvo: ${GUILD_ID}`);

  const config = await serverService.getConfig(GUILD_ID);
  if (!config.vendas) config.vendas = {};
  if (!config.vendas.produtos) config.vendas.produtos = [];
  if (!config.vendas.precos) config.vendas.precos = {};

  const norm = (s) => String(s).trim().toLowerCase();
  const agora = new Date().toISOString();

  let criados = 0;
  let atualizados = 0;

  for (const arma of ARMAS) {
    let produto = config.vendas.produtos.find((p) => norm(p.nome) === norm(arma.nome));

    if (!produto) {
      produto = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        nome: arma.nome,
        data_criacao: agora,
      };
      config.vendas.produtos.push(produto);
      criados++;
    } else {
      produto.nome = arma.nome; // normaliza pro texto exato da imagem
      atualizados++;
    }

    config.vendas.precos[produto.id] = {
      ...(config.vendas.precos[produto.id] || {}),
      nome: arma.nome,
      preco_parceria: arma.parceria,
      preco_pista: arma.pista,
      data_atualizacao: agora,
    };
  }

  await serverService.saveConfig(GUILD_ID, config);

  console.log(`✅ Calculadora atualizada: ${criados} produto(s) criado(s), ${atualizados} atualizado(s).`);
  console.table(ARMAS.map((a) => ({ Arma: a.nome, Parceria: a.parceria, Pista: a.pista })));

  await pool.end();
})().catch((err) => {
  console.error('❌ Erro ao atualizar calculadora:', err);
  process.exit(1);
});
