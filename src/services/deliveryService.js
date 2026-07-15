const pool = require('../db');

// Pegar server_id e member_id em uma query
async function getServerAndMemberId(guildId, discordId) {
  const result = await pool.query(
    `SELECT s.id as servidor_id, m.id as membro_id
     FROM servidores s
     LEFT JOIN membros m ON m.servidor_id = s.id AND m.discord_id = $2
     WHERE s.guild_id = $1`,
    [guildId, discordId]
  );
  if (result.rows.length === 0) throw new Error('Servidor não encontrado');
  if (!result.rows[0].membro_id) throw new Error('Membro não encontrado');
  return {
    servidorId: result.rows[0].servidor_id,
    memberId: result.rows[0].membro_id,
  };
}

// Criar entrega
async function createDelivery(guildId, discordId, itens, printUrl) {
  const client = await pool.connect();
  try {
    const { servidorId, memberId } = await getServerAndMemberId(guildId, discordId);

    await client.query('BEGIN');

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

// Início da semana de farm vigente (segunda-feira 00:00)
function inicioDaSemanaAtual() {
  const agora = new Date();
  const diaDaSemana = agora.getDay(); // 0=domingo, 1=segunda, ...
  const diasDesdeSegunda = (diaDaSemana + 6) % 7; // segunda=0, ..., domingo=6
  const inicio = new Date(agora);
  inicio.setDate(agora.getDate() - diasDesdeSegunda);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

// Soma quanto de cada item o membro já entregou na semana vigente
// (conta pendentes + aprovadas, ignora rejeitadas), pra aplicar o teto
// semanal por item e não deixar entregar demais de um material só.
async function getQuantidadeEntregueSemanaAtual(guildId, discordId) {
  try {
    const result = await pool.query(
      `SELECT ie.item_nome, SUM(ie.quantidade) AS total
       FROM itens_entregues ie
       JOIN entregas_farm e ON ie.entrega_id = e.id
       JOIN membros m ON e.membro_id = m.id
       JOIN servidores s ON e.servidor_id = s.id
       WHERE m.discord_id = $1
         AND s.guild_id = $2
         AND e.status != 'rejeitada'
         AND e.data_entrega >= $3
       GROUP BY ie.item_nome`,
      [discordId, guildId, inicioDaSemanaAtual()]
    );

    const totais = {};
    for (const row of result.rows) {
      totais[row.item_nome] = parseInt(row.total, 10);
    }
    return totais;
  } catch (error) {
    console.error('Erro ao somar entregas da semana:', error);
    throw error;
  }
}

// Estatísticas de entregas aprovadas: total de entregas e soma de unidades
// entregues. Passe `desde` pra filtrar (ex: início da semana vigente); sem
// isso, conta o histórico inteiro.
async function getEstatisticasEntregas(guildId, desde = null) {
  try {
    const condicaoData = desde ? 'AND e.data_aprovacao >= $2' : '';
    const params = desde ? [guildId, desde] : [guildId];

    const result = await pool.query(
      `SELECT COUNT(DISTINCT e.id) AS total_entregas, COALESCE(SUM(ie.quantidade), 0) AS total_itens
       FROM entregas_farm e
       JOIN itens_entregues ie ON ie.entrega_id = e.id
       JOIN servidores s ON e.servidor_id = s.id
       WHERE s.guild_id = $1
         AND e.status = 'aprovada'
         ${condicaoData}`,
      params
    );

    return {
      totalEntregas: parseInt(result.rows[0].total_entregas, 10),
      totalItens: parseInt(result.rows[0].total_itens, 10),
    };
  } catch (error) {
    console.error('Erro ao pegar estatísticas de entregas:', error);
    throw error;
  }
}

// Total entregue de cada item (agregado de todo mundo). Passe `desde` pra
// filtrar (ex: início da semana vigente); sem isso, soma o histórico inteiro.
async function getTotaisPorItem(guildId, desde = null) {
  try {
    const condicaoData = desde ? 'AND e.data_aprovacao >= $2' : '';
    const params = desde ? [guildId, desde] : [guildId];

    const result = await pool.query(
      `SELECT ie.item_nome, SUM(ie.quantidade) AS total
       FROM itens_entregues ie
       JOIN entregas_farm e ON ie.entrega_id = e.id
       JOIN servidores s ON e.servidor_id = s.id
       WHERE s.guild_id = $1
         AND e.status = 'aprovada'
         ${condicaoData}
       GROUP BY ie.item_nome
       ORDER BY total DESC`,
      params
    );

    return result.rows.map((row) => ({
      itemNome: row.item_nome,
      total: parseInt(row.total, 10),
    }));
  } catch (error) {
    console.error('Erro ao pegar totais por item:', error);
    throw error;
  }
}

// Ranking de quem mais entregou (por unidades), com o total de entregas de
// cada um. Passe `desde` pra filtrar (ex: início da semana vigente); sem
// isso, ranqueia o histórico inteiro. Sem `limite`, traz todo mundo que
// entregou pelo menos uma vez.
async function getRankingEntregas(guildId, desde = null, limite = null) {
  try {
    const condicaoData = desde ? 'AND e.data_aprovacao >= $2' : '';
    const params = desde ? [guildId, desde] : [guildId];
    if (limite) params.push(limite);
    const limiteClause = limite ? `LIMIT $${params.length}` : '';

    const result = await pool.query(
      `SELECT m.discord_id, COUNT(DISTINCT e.id) AS total_entregas, COALESCE(SUM(ie.quantidade), 0) AS total_itens
       FROM entregas_farm e
       JOIN membros m ON e.membro_id = m.id
       JOIN itens_entregues ie ON ie.entrega_id = e.id
       JOIN servidores s ON e.servidor_id = s.id
       WHERE s.guild_id = $1
         AND e.status = 'aprovada'
         ${condicaoData}
       GROUP BY m.discord_id
       ORDER BY total_itens DESC
       ${limiteClause}`,
      params
    );

    return result.rows.map((row) => ({
      discordId: row.discord_id,
      totalEntregas: parseInt(row.total_entregas, 10),
      totalItens: parseInt(row.total_itens, 10),
    }));
  } catch (error) {
    console.error('Erro ao pegar ranking de entregas:', error);
    throw error;
  }
}

// Conta quantas entregas um membro tem no total (pra confirmar antes de limpar)
async function contarEntregasPorMembro(guildId, discordId) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS count
       FROM entregas_farm e
       JOIN membros m ON e.membro_id = m.id
       JOIN servidores s ON e.servidor_id = s.id
       WHERE m.discord_id = $1 AND s.guild_id = $2`,
      [discordId, guildId]
    );
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('Erro ao contar entregas do membro:', error);
    throw error;
  }
}

// Apaga todas as entregas de um membro (itens_entregues vai junto por
// ON DELETE CASCADE). Usado pra limpar farm de teste que travou o limite
// semanal. Retorna quantas entregas foram apagadas.
async function deletarEntregasPorMembro(guildId, discordId) {
  try {
    const result = await pool.query(
      `DELETE FROM entregas_farm
       WHERE id IN (
         SELECT e.id FROM entregas_farm e
         JOIN membros m ON e.membro_id = m.id
         JOIN servidores s ON e.servidor_id = s.id
         WHERE m.discord_id = $1 AND s.guild_id = $2
       )
       RETURNING id`,
      [discordId, guildId]
    );
    return result.rows.length;
  } catch (error) {
    console.error('Erro ao deletar entregas do membro:', error);
    throw error;
  }
}

// Pegar todas as entregas e detalhes completos
async function getDeliveryWithItems(entregaId) {
  try {
    const entrega = await getDelivery(entregaId);
    if (!entrega) return null;

    const items = await getDeliveryItems(entregaId);
    return {
      ...entrega,
      items,
    };
  } catch (error) {
    console.error('Erro ao pegar entrega com items:', error);
    throw error;
  }
}

module.exports = {
  createDelivery,
  approveDelivery,
  rejectDelivery,
  getDelivery,
  getDeliveryItems,
  getDeliveryWithItems,
  getApprovedDeliveries,
  getQuantidadeEntregueSemanaAtual,
  getEstatisticasEntregas,
  getRankingEntregas,
  getTotaisPorItem,
  contarEntregasPorMembro,
  deletarEntregasPorMembro,
  inicioDaSemanaAtual,
};
