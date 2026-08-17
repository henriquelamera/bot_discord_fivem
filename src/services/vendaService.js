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
         preco_unitario, valor_total, faccao_nome, registrado_por
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        servidorId,
        dados.produtoId,
        dados.produtoNome,
        dados.tipo,
        dados.quantidade,
        dados.precoUnitario,
        dados.valorTotal,
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

// Nomes distintos de facções que já tiveram parceria registrada - usado pra
// popular o seletor de facção na venda com parceria
async function listarFaccoesParceria(guildId) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT p.nome_faccao FROM parcerias p
       JOIN servidores s ON p.servidor_id = s.id
       WHERE s.guild_id = $1
       ORDER BY p.nome_faccao ASC`,
      [guildId]
    );
    return result.rows.map((r) => r.nome_faccao);
  } catch (error) {
    console.error('Erro ao listar facções de parceria:', error);
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

module.exports = { registrarVenda, listarFaccoesParceria, listarVendas };
