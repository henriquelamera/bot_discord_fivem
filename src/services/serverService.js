const pool = require('../db');
const crypto = require('crypto');

// Registrar novo servidor
async function registerServer(guildId, nomeServidor, ownerId) {
  try {
    const result = await pool.query(
      `INSERT INTO servidores (guild_id, nome_servidor, owner_id, plano)
       VALUES ($1, $2, $3, 'free')
       ON CONFLICT (guild_id)
       DO UPDATE SET nome_servidor = $2, ativo = true
       RETURNING *`,
      [guildId, nomeServidor, ownerId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao registrar servidor:', error);
    throw error;
  }
}

// Pegar servidor
async function getServer(guildId) {
  try {
    const result = await pool.query(
      'SELECT * FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Erro ao pegar servidor:', error);
    throw error;
  }
}

// Criar API Key
async function createAPIKey(guildId, nomeChave, permissoes = ['read', 'write']) {
  try {
    const servidorResult = await pool.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    if (servidorResult.rows.length === 0) throw new Error('Servidor não encontrado');
    const servidorId = servidorResult.rows[0].id;

    // Gerar token seguro
    const token = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
      `INSERT INTO api_keys (servidor_id, chave_token, nome_chave, permissoes, ativa)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, chave_token, nome_chave, permissoes`,
      [servidorId, token, nomeChave, permissoes]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao criar API key:', error);
    throw error;
  }
}

// Validar API Key
async function validateAPIKey(token, permissaoNecessaria = 'read') {
  try {
    const result = await pool.query(
      `SELECT s.*, a.permissoes
       FROM api_keys a
       JOIN servidores s ON a.servidor_id = s.id
       WHERE a.chave_token = $1 AND a.ativa = true`,
      [token]
    );

    if (result.rows.length === 0) return null;

    const chave = result.rows[0];
    if (!chave.permissoes.includes(permissaoNecessaria)) return null;

    // Atualizar último uso
    await pool.query(
      'UPDATE api_keys SET ultimo_uso = NOW() WHERE chave_token = $1',
      [token]
    );

    return chave;
  } catch (error) {
    console.error('Erro ao validar API key:', error);
    throw error;
  }
}

// Listar API Keys de um servidor
async function listAPIKeys(guildId) {
  try {
    const result = await pool.query(
      `SELECT a.id, a.nome_chave, a.permissoes, a.data_criacao, a.ultimo_uso, a.ativa
       FROM api_keys a
       JOIN servidores s ON a.servidor_id = s.id
       WHERE s.guild_id = $1
       ORDER BY a.data_criacao DESC`,
      [guildId]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao listar API keys:', error);
    throw error;
  }
}

// Desativar API Key
async function deactivateAPIKey(keyId) {
  try {
    const result = await pool.query(
      'UPDATE api_keys SET ativa = false WHERE id = $1 RETURNING *',
      [keyId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao desativar API key:', error);
    throw error;
  }
}

// Registrar ação no log
async function logAction(guildId, usuarioId, acao, descricao) {
  try {
    const servidorResult = await pool.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    if (servidorResult.rows.length === 0) return;
    const servidorId = servidorResult.rows[0].id;

    await pool.query(
      `INSERT INTO logs (servidor_id, usuario_id, acao, descricao)
       VALUES ($1, $2, $3, $4)`,
      [servidorId, usuarioId, acao, descricao]
    );
  } catch (error) {
    console.error('Erro ao registrar log:', error);
    throw error;
  }
}

// Pegar logs de um servidor
async function getLogs(guildId, limit = 100) {
  try {
    const result = await pool.query(
      `SELECT * FROM logs
       WHERE servidor_id = (SELECT id FROM servidores WHERE guild_id = $1)
       ORDER BY data_log DESC
       LIMIT $2`,
      [guildId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao pegar logs:', error);
    throw error;
  }
}

// Pegar senha do painel
async function getSenhaPainel(guildId) {
  try {
    const result = await pool.query(
      `SELECT config_json FROM config_servidor
       WHERE servidor_id = (SELECT id FROM servidores WHERE guild_id = $1)`,
      [guildId]
    );
    if (result.rows.length === 0) return null;
    const config = result.rows[0].config_json;
    return config?.senha_painel || null;
  } catch (error) {
    console.error('Erro ao pegar senha:', error);
    throw error;
  }
}

// Validar senha do painel
async function validarSenhaPainel(guildId, senha) {
  try {
    const senhaCorreta = await getSenhaPainel(guildId);
    return senhaCorreta === senha;
  } catch (error) {
    console.error('Erro ao validar senha:', error);
    throw error;
  }
}

// Pegar todas as configurações do servidor
async function getConfig(guildId) {
  try {
    const result = await pool.query(
      `SELECT config_json FROM config_servidor
       WHERE servidor_id = (SELECT id FROM servidores WHERE guild_id = $1)`,
      [guildId]
    );
    if (result.rows.length === 0) return {};
    return result.rows[0].config_json || {};
  } catch (error) {
    console.error('Erro ao pegar configurações:', error);
    return {};
  }
}

// Salvar configurações do servidor
async function saveConfig(guildId, config) {
  try {
    const servidorResult = await pool.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    if (servidorResult.rows.length === 0) {
      throw new Error('Servidor não registrado');
    }
    const servidorId = servidorResult.rows[0].id;

    await pool.query(
      `INSERT INTO config_servidor (servidor_id, config_json, data_atualizacao)
       VALUES ($1, $2, NOW())
       ON CONFLICT (servidor_id)
       DO UPDATE SET config_json = $2, data_atualizacao = NOW()`,
      [servidorId, JSON.stringify(config)]
    );
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    throw error;
  }
}

// Atualizar um campo específico na configuração
async function updateConfigField(guildId, field, value) {
  try {
    const config = await getConfig(guildId);
    config[field] = value;
    await saveConfig(guildId, config);
  } catch (error) {
    console.error('Erro ao atualizar campo de configuração:', error);
    throw error;
  }
}

module.exports = {
  registerServer,
  getServer,
  createAPIKey,
  validateAPIKey,
  listAPIKeys,
  deactivateAPIKey,
  logAction,
  getLogs,
  getSenhaPainel,
  validarSenhaPainel,
  getConfig,
  saveConfig,
  updateConfigField,
};
