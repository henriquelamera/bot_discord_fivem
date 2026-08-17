const pool = require('../db');

// Registrar uma nova parceria
async function createParceria(guildId, dados) {
  try {
    const servidorResult = await pool.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    if (servidorResult.rows.length === 0) throw new Error('Servidor não encontrado');
    const servidorId = servidorResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO parcerias (
         servidor_id, registrado_por_id, responsavel_outra_faccao,
         nome_faccao, produto, nome_darkchat, senha_darkchat,
         print_parceria_url, print_mapa_url, canal_id, mensagem_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        servidorId,
        dados.registradoPorId,
        dados.responsavelOutraFaccao,
        dados.nomeFaccao,
        dados.produto,
        dados.nomeDarkchat,
        dados.senhaDarkchat,
        dados.printParceriaUrl,
        dados.printMapaUrl,
        dados.canalId,
        dados.mensagemId,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao criar parceria:', error);
    throw error;
  }
}

// Listar parcerias de um servidor (mais recentes primeiro)
async function listarParcerias(guildId, limit = 50) {
  try {
    const result = await pool.query(
      `SELECT p.* FROM parcerias p
       JOIN servidores s ON p.servidor_id = s.id
       WHERE s.guild_id = $1
       ORDER BY p.data_registro DESC
       LIMIT $2`,
      [guildId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao listar parcerias:', error);
    throw error;
  }
}

module.exports = { createParceria, listarParcerias };
