const pool = require('../db');

// Adicionar ADV
async function addADV(guildId, discordId, numeroAdv, motivo = '') {
  try {
    const servidorResult = await pool.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    if (servidorResult.rows.length === 0) throw new Error('Servidor não encontrado');
    const servidorId = servidorResult.rows[0].id;

    const memberResult = await pool.query(
      `SELECT id FROM membros
       WHERE discord_id = $1 AND servidor_id = $2`,
      [discordId, servidorId]
    );
    if (memberResult.rows.length === 0) throw new Error('Membro não encontrado');

    const result = await pool.query(
      `INSERT INTO advs (servidor_id, membro_id, numero_adv, motivo)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [servidorId, memberResult.rows[0].id, numeroAdv, motivo]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao adicionar ADV:', error);
    throw error;
  }
}

// Remover ADV
async function removeADV(guildId, discordId, numeroAdv) {
  try {
    const result = await pool.query(
      `DELETE FROM advs
       WHERE membro_id = (
         SELECT m.id FROM membros m
         JOIN servidores s ON m.servidor_id = s.id
         WHERE m.discord_id = $1 AND s.guild_id = $2
       )
       AND numero_adv = $3
       RETURNING *`,
      [discordId, guildId, numeroAdv]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao remover ADV:', error);
    throw error;
  }
}

// Contar ADVs do membro
async function countADVs(guildId, discordId) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM advs
       WHERE membro_id = (
         SELECT m.id FROM membros m
         JOIN servidores s ON m.servidor_id = s.id
         WHERE m.discord_id = $1 AND s.guild_id = $2
       )`,
      [discordId, guildId]
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Erro ao contar ADVs:', error);
    throw error;
  }
}

// Pegar ADVs do membro
async function getADVs(guildId, discordId) {
  try {
    const result = await pool.query(
      `SELECT * FROM advs
       WHERE membro_id = (
         SELECT m.id FROM membros m
         JOIN servidores s ON m.servidor_id = s.id
         WHERE m.discord_id = $1 AND s.guild_id = $2
       )
       ORDER BY numero_adv DESC`,
      [discordId, guildId]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao pegar ADVs:', error);
    throw error;
  }
}

// Remover todos os ADVs
async function removeAllADVs(guildId, discordId) {
  try {
    const result = await pool.query(
      `DELETE FROM advs
       WHERE membro_id = (
         SELECT m.id FROM membros m
         JOIN servidores s ON m.servidor_id = s.id
         WHERE m.discord_id = $1 AND s.guild_id = $2
       )
       RETURNING *`,
      [discordId, guildId]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao remover todos os ADVs:', error);
    throw error;
  }
}

module.exports = {
  addADV,
  removeADV,
  countADVs,
  getADVs,
  removeAllADVs,
};
