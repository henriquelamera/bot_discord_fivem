const pool = require('../db');
const crypto = require('crypto');

// Cache simples com TTL de 30 segundos
const configCache = new Map();
const CONFIG_CACHE_TTL = 30000; // 30 segundos

function getFromCache(key) {
  const cached = configCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CONFIG_CACHE_TTL) {
    configCache.delete(key);
    return null;
  }
  return cached.value;
}

function setInCache(key, value) {
  configCache.set(key, {
    value,
    timestamp: Date.now(),
  });
}

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

// Pegar a data da ação mais recente de um usuário (ex: 'abrir_bau'), usada
// pra saber há quanto tempo alguém está sujeito a uma obrigação recorrente
async function getDataUltimaAcao(guildId, usuarioId, acao) {
  try {
    const result = await pool.query(
      `SELECT data_log FROM logs
       WHERE servidor_id = (SELECT id FROM servidores WHERE guild_id = $1)
       AND usuario_id = $2
       AND acao = $3
       ORDER BY data_log DESC
       LIMIT 1`,
      [guildId, usuarioId, acao]
    );
    return result.rows.length > 0 ? result.rows[0].data_log : null;
  } catch (error) {
    console.error('Erro ao pegar última ação:', error);
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

// Pegar todas as configurações do servidor (com cache)
async function getConfig(guildId) {
  try {
    // Verificar cache primeiro
    const cached = getFromCache(`config:${guildId}`);
    if (cached) return cached;

    const result = await pool.query(
      `SELECT cs.config_json FROM config_servidor cs
       JOIN servidores s ON cs.servidor_id = s.id
       WHERE s.guild_id = $1`,
      [guildId]
    );
    const config = result.rows.length > 0 ? (result.rows[0].config_json || {}) : {};

    // Salvar em cache
    setInCache(`config:${guildId}`, config);
    return config;
  } catch (error) {
    console.error('Erro ao pegar configurações:', error);
    return {};
  }
}

// Salvar configurações do servidor
async function saveConfig(guildId, config) {
  try {
    // Garantir que servidor está registrado (uma única query com ON CONFLICT)
    await registerServer(guildId, `Servidor ${guildId}`, guildId);

    const servidorResult = await pool.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );

    if (servidorResult.rows.length === 0) {
      throw new Error('Falha ao registrar servidor');
    }

    const servidorId = servidorResult.rows[0].id;

    await pool.query(
      `INSERT INTO config_servidor (servidor_id, config_json, data_atualizacao)
       VALUES ($1, $2, NOW())
       ON CONFLICT (servidor_id)
       DO UPDATE SET config_json = $2, data_atualizacao = NOW()`,
      [servidorId, JSON.stringify(config)]
    );

    // Invalidar cache após salvar
    configCache.delete(`config:${guildId}`);
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    throw error;
  }
}

// Garante que existe uma linha de config para o servidor (necessário antes
// de rodar updates atômicos em cima do config_json)
async function ensureServidorEConfig(guildId) {
  await registerServer(guildId, `Servidor ${guildId}`, guildId);

  const servidorResult = await pool.query(
    'SELECT id FROM servidores WHERE guild_id = $1',
    [guildId]
  );
  const servidorId = servidorResult.rows[0].id;

  await pool.query(
    `INSERT INTO config_servidor (servidor_id, config_json, data_atualizacao)
     VALUES ($1, '{}'::jsonb, NOW())
     ON CONFLICT (servidor_id) DO NOTHING`,
    [servidorId]
  );

  return servidorId;
}

// Adiciona uma entrega de farm em config.farm.entregas de forma atômica
// (evita que duas entregas concorrentes se sobrescrevam - diferente de
// saveConfig, que reescreve a config inteira e pode perder dados nesse caso)
async function appendEntregaFarm(guildId, entrega) {
  try {
    const servidorId = await ensureServidorEConfig(guildId);

    await pool.query(
      `UPDATE config_servidor
       SET config_json = jsonb_set(
         jsonb_set(config_json, '{farm}', COALESCE(config_json->'farm', '{}'::jsonb), true),
         '{farm,entregas}',
         COALESCE(config_json->'farm'->'entregas', '[]'::jsonb) || $2::jsonb,
         true
       ),
       data_atualizacao = NOW()
       WHERE servidor_id = $1`,
      [servidorId, JSON.stringify([entrega])]
    );

    configCache.delete(`config:${guildId}`);
  } catch (error) {
    console.error('Erro ao adicionar entrega de farm:', error);
    throw error;
  }
}

// Mescla campos (patch) em uma entrega específica de config.farm.entregas,
// pelo id, de forma atômica - usado por aprovar/recusar/marcar como pago,
// pra não sobrescrever mudanças feitas em outras entregas ao mesmo tempo.
async function patchEntregaFarm(guildId, entregaId, patch) {
  try {
    const servidorId = await ensureServidorEConfig(guildId);

    const result = await pool.query(
      `UPDATE config_servidor
       SET config_json = jsonb_set(
         config_json,
         '{farm,entregas}',
         (
           SELECT COALESCE(jsonb_agg(
             CASE WHEN (elem->>'id') = $2 THEN elem || $3::jsonb ELSE elem END
           ), '[]'::jsonb)
           FROM jsonb_array_elements(COALESCE(config_json->'farm'->'entregas', '[]'::jsonb)) AS elem
         )
       ),
       data_atualizacao = NOW()
       WHERE servidor_id = $1
       RETURNING config_json`,
      [servidorId, String(entregaId), JSON.stringify(patch)]
    );

    configCache.delete(`config:${guildId}`);

    const entregas = result.rows[0]?.config_json?.farm?.entregas || [];
    return entregas.find((e) => String(e.id) === String(entregaId)) || null;
  } catch (error) {
    console.error('Erro ao atualizar entrega de farm:', error);
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
  getDataUltimaAcao,
  getSenhaPainel,
  validarSenhaPainel,
  getConfig,
  saveConfig,
  updateConfigField,
  appendEntregaFarm,
  patchEntregaFarm,
};
