const pool = require('../db');

// Registrar uma venda confirmada pela calculadora web
async function registrarVenda(guildId, dados) {
  try {
    const servidorResult = await pool.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    if (servidorResult.rows.length === 0) throw new Error('Servidor não encontrado');
    const servidorId = servidorResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO vendas_registradas (
         servidor_id, produto_id, produto_nome, tipo, quantidade,
         preco_unitario, valor_total, parceria_id, faccao_nome, registrado_por
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        servidorId,
        dados.produtoId,
        dados.produtoNome,
        dados.tipo,
        dados.quantidade,
        dados.precoUnitario,
        dados.valorTotal,
        dados.parceriaId || null,
        dados.faccaoNome || null,
        dados.registradoPor || null,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao registrar venda:', error);
    throw error;
  }
}

// Uma parceria por facção (a mais recente) - usado pra popular o seletor da
// venda com parceria. O id da parceria vira o valor interno do select
// (satisfaz "identificador da parceria como valor interno"), o nome da
// facção é só o texto mostrado. DISTINCT ON evita mostrar a mesma facção
// repetida quando ela tem várias parcerias registradas (produtos diferentes).
async function listarFaccoesParceria(guildId) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (p.nome_faccao) p.id, p.nome_faccao
       FROM parcerias p
       JOIN servidores s ON p.servidor_id = s.id
       WHERE s.guild_id = $1
       ORDER BY p.nome_faccao ASC, p.data_registro DESC`,
      [guildId]
    );
    return result.rows.map((r) => ({ id: r.id, nome: r.nome_faccao }));
  } catch (error) {
    console.error('Erro ao listar facções de parceria:', error);
    throw error;
  }
}

// Resolve o nome da facção a partir do id de uma parceria - usado pro
// backend nunca confiar no nome enviado pelo cliente quando uma parceria
// específica foi selecionada (só confia no texto livre da venda "pista")
async function getNomeFaccaoPorParceriaId(guildId, parceriaId) {
  try {
    const result = await pool.query(
      `SELECT p.nome_faccao FROM parcerias p
       JOIN servidores s ON p.servidor_id = s.id
       WHERE s.guild_id = $1 AND p.id = $2`,
      [guildId, parceriaId]
    );
    return result.rows[0]?.nome_faccao || null;
  } catch (error) {
    console.error('Erro ao resolver nome da facção:', error);
    throw error;
  }
}

// Listar vendas registradas de um servidor (mais recentes primeiro)
async function listarVendas(guildId, limit = 100) {
  try {
    const result = await pool.query(
      `SELECT v.* FROM vendas_registradas v
       JOIN servidores s ON v.servidor_id = s.id
       WHERE s.guild_id = $1
       ORDER BY v.data_registro DESC
       LIMIT $2`,
      [guildId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao listar vendas:', error);
    throw error;
  }
}

module.exports = { registrarVenda, listarFaccoesParceria, getNomeFaccaoPorParceriaId, listarVendas };
