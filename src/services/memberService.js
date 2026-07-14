const pool = require('../db');

// Pegar server_id pelo guildId (helper para evitar redundância)
async function getServerId(guildId) {
  const result = await pool.query(
    'SELECT id FROM servidores WHERE guild_id = $1',
    [guildId]
  );
  if (result.rows.length === 0) throw new Error('Servidor não encontrado');
  return result.rows[0].id;
}

// Adicionar/atualizar membro em um servidor específico
async function saveMember(guildId, discordId, nomeInGame, idInGame, nomeFormatado) {
  try {
    const servidorId = await getServerId(guildId);

    const result = await pool.query(
      `INSERT INTO membros (servidor_id, discord_id, nome_ingame, id_ingame, nome_formatado, aprovado)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (servidor_id, discord_id)
       DO UPDATE SET nome_ingame = $3, id_ingame = $4, nome_formatado = $5
       RETURNING *`,
      [servidorId, discordId, nomeInGame, idInGame, nomeFormatado]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao salvar membro:', error);
    throw error;
  }
}

// Aprovar membro
async function approveMember(guildId, discordId) {
  try {
    const servidorId = await getServerId(guildId);
    const result = await pool.query(
      `UPDATE membros
       SET aprovado = true, data_aprovacao = NOW()
       WHERE discord_id = $1 AND servidor_id = $2
       RETURNING *`,
      [discordId, servidorId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao aprovar membro:', error);
    throw error;
  }
}

// Verificar se membro foi aprovado
async function isMemberApproved(guildId, discordId) {
  try {
    const servidorId = await getServerId(guildId);
    const result = await pool.query(
      `SELECT aprovado FROM membros
       WHERE discord_id = $1 AND servidor_id = $2`,
      [discordId, servidorId]
    );
    if (result.rows.length === 0) return false;
    return result.rows[0].aprovado;
  } catch (error) {
    console.error('Erro ao verificar aprovação:', error);
    throw error;
  }
}

// Pegar info do membro
async function getMember(guildId, discordId) {
  try {
    const servidorId = await getServerId(guildId);
    const result = await pool.query(
      `SELECT * FROM membros
       WHERE discord_id = $1 AND servidor_id = $2`,
      [discordId, servidorId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Erro ao pegar membro:', error);
    throw error;
  }
}

// Deletar membro
async function deleteMember(guildId, discordId) {
  try {
    const servidorId = await getServerId(guildId);
    const result = await pool.query(
      `DELETE FROM membros
       WHERE discord_id = $1 AND servidor_id = $2
       RETURNING *`,
      [discordId, servidorId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao deletar membro:', error);
    throw error;
  }
}

module.exports = {
  saveMember,
  approveMember,
  isMemberApproved,
  getMember,
  deleteMember,
};
