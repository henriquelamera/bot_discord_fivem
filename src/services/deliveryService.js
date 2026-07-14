const pool = require('../db');

// Criar entrega
async function createDelivery(guildId, discordId, itens, printUrl) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Pegar ID do membro
    const memberResult = await client.query(
      `SELECT id FROM membros
       WHERE discord_id = $1
       AND servidor_id = (SELECT id FROM servidores WHERE guild_id = $2)`,
      [discordId, guildId]
    );
    if (memberResult.rows.length === 0) throw new Error('Membro não encontrado');
    const memberId = memberResult.rows[0].id;

    // Pegar servidor_id
    const servidorResult = await client.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    const servidorId = servidorResult.rows[0].id;

    // Criar entrega
    const entregaResult = await client.query(
      `INSERT INTO entregas_farm (servidor_id, membro_id, status, print_url)
       VALUES ($1, $2, 'pendente_aprovacao', $3)
       RETURNING id`,
      [servidorId, memberId, printUrl]
    );
    const entregaId = entregaResult.rows[0].id;

    // Adicionar items
    for (const [itemId, dados] of Object.entries(itens)) {
      await client.query(
        `INSERT INTO itens_entregues (entrega_id, item_nome, quantidade, meta_semanal)
         VALUES ($1, $2, $3, $4)`,
        [entregaId, dados.nome, dados.quantidade, 0]
      );
    }

    await client.query('COMMIT');
    return entregaId;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar entrega:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Aprovar entrega
async function approveDelivery(entregaId, aprovadorId) {
  try {
    const result = await pool.query(
      `UPDATE entregas_farm
       SET status = 'aprovada', data_aprovacao = NOW(), aprovador_id = $1
       WHERE id = $2
       RETURNING *`,
      [aprovadorId, entregaId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao aprovar entrega:', error);
    throw error;
  }
}

// Rejeitar entrega
async function rejectDelivery(entregaId, motivo) {
  try {
    const result = await pool.query(
      `UPDATE entregas_farm
       SET status = 'rejeitada', motivo_rejeicao = $1
       WHERE id = $2
       RETURNING *`,
      [motivo, entregaId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao rejeitar entrega:', error);
    throw error;
  }
}

// Pegar entrega
async function getDelivery(entregaId) {
  try {
    const result = await pool.query(
      `SELECT e.*, m.discord_id, s.guild_id
       FROM entregas_farm e
       JOIN membros m ON e.membro_id = m.id
       JOIN servidores s ON e.servidor_id = s.id
       WHERE e.id = $1`,
      [entregaId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Erro ao pegar entrega:', error);
    throw error;
  }
}

// Pegar items de uma entrega
async function getDeliveryItems(entregaId) {
  try {
    const result = await pool.query(
      'SELECT * FROM itens_entregues WHERE entrega_id = $1',
      [entregaId]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao pegar items:', error);
    throw error;
  }
}

// Pegar últimas entregas aprovadas do membro
async function getApprovedDeliveries(guildId, discordId, days = 7) {
  try {
    const result = await pool.query(
      `SELECT e.* FROM entregas_farm e
       JOIN membros m ON e.membro_id = m.id
       JOIN servidores s ON e.servidor_id = s.id
       WHERE m.discord_id = $1
       AND s.guild_id = $2
       AND e.status = 'aprovada'
       AND e.data_aprovacao >= NOW() - INTERVAL '${days} days'
       ORDER BY e.data_aprovacao DESC`,
      [discordId, guildId]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao pegar entregas aprovadas:', error);
    throw error;
  }
}

module.exports = {
  createDelivery,
  approveDelivery,
  rejectDelivery,
  getDelivery,
  getDeliveryItems,
  getApprovedDeliveries,
};
