const pool = require('../db');

// Pegar server_id e member_id (helper)
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

// Adicionar ADV
async function addADV(guildId, discordId, numeroAdv, motivo = '') {
  try {
    const { servidorId, memberId } = await getServerAndMemberId(guildId, discordId);
    const result = await pool.query(
      `INSERT INTO advs (servidor_id, membro_id, numero_adv, motivo)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [servidorId, memberId, numeroAdv, motivo]
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
    const { memberId } = await getServerAndMemberId(guildId, discordId);
    const result = await pool.query(
      `DELETE FROM advs WHERE membro_id = $1 AND numero_adv = $2 RETURNING *`,
      [memberId, numeroAdv]
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
    const { memberId } = await getServerAndMemberId(guildId, discordId);
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM advs WHERE membro_id = $1',
      [memberId]
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
    const { memberId } = await getServerAndMemberId(guildId, discordId);
    const result = await pool.query(
      'SELECT * FROM advs WHERE membro_id = $1 ORDER BY numero_adv DESC',
      [memberId]
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
    const { memberId } = await getServerAndMemberId(guildId, discordId);
    const result = await pool.query(
      'DELETE FROM advs WHERE membro_id = $1 RETURNING *',
      [memberId]
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
