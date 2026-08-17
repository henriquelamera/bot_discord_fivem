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
        dados.printParceriaUrl || null,
        dados.printMapaUrl || null,
        dados.canalId,
        dados.mensagemId || null,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao criar parceria:', error);
    throw error;
  }
}

// Preenche o id da mensagem publicada depois que ela já foi enviada (o id só
// existe depois do send, mas o registro no banco é criado antes pra já
// existir um id de parceria pra colocar no customId do botão de imagens)
async function definirMensagemParceria(parceriaId, mensagemId) {
  try {
    await pool.query('UPDATE parcerias SET mensagem_id = $1 WHERE id = $2', [mensagemId, parceriaId]);
  } catch (error) {
    console.error('Erro ao atualizar mensagem da parceria:', error);
    throw error;
  }
}

// Adiciona os prints depois que a parceria já foi publicada sem eles
async function atualizarImagensParceria(parceriaId, printParceriaUrl, printMapaUrl) {
  try {
    const result = await pool.query(
      'UPDATE parcerias SET print_parceria_url = $1, print_mapa_url = $2 WHERE id = $3 RETURNING *',
      [printParceriaUrl, printMapaUrl, parceriaId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao atualizar imagens da parceria:', error);
    throw error;
  }
}

async function buscarParceriaPorId(parceriaId) {
  try {
    const result = await pool.query('SELECT * FROM parcerias WHERE id = $1', [parceriaId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Erro ao buscar parceria por id:', error);
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

module.exports = { createParceria, listarParcerias, definirMensagemParceria, atualizarImagensParceria, buscarParceriaPorId };
