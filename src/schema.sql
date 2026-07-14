-- Tabela de Servidores (Guilds)
CREATE TABLE IF NOT EXISTS servidores (
  id SERIAL PRIMARY KEY,
  guild_id VARCHAR(20) UNIQUE NOT NULL,
  nome_servidor VARCHAR(100),
  owner_id VARCHAR(20) NOT NULL,
  data_criacao TIMESTAMP DEFAULT NOW(),
  plano VARCHAR(50) DEFAULT 'free', -- free, premium, enterprise
  ativo BOOLEAN DEFAULT true
);

-- Tabela de API Keys/Tokens
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  servidor_id INT REFERENCES servidores(id) ON DELETE CASCADE,
  chave_token VARCHAR(64) UNIQUE NOT NULL,
  nome_chave VARCHAR(100),
  permissoes TEXT[], -- array de permissões: ['read', 'write', 'admin']
  data_criacao TIMESTAMP DEFAULT NOW(),
  ultimo_uso TIMESTAMP,
  ativa BOOLEAN DEFAULT true
);

-- Tabela de Membros (agora com guild_id)
CREATE TABLE IF NOT EXISTS membros (
  id SERIAL PRIMARY KEY,
  servidor_id INT REFERENCES servidores(id) ON DELETE CASCADE,
  discord_id VARCHAR(20) NOT NULL,
  nome_ingame VARCHAR(100),
  id_ingame INT,
  nome_formatado VARCHAR(150),
  aprovado BOOLEAN DEFAULT false,
  data_registro TIMESTAMP DEFAULT NOW(),
  data_aprovacao TIMESTAMP,
  UNIQUE(servidor_id, discord_id)
);

-- Tabela de Entregas de Farm (agora com servidor)
CREATE TABLE IF NOT EXISTS entregas_farm (
  id SERIAL PRIMARY KEY,
  servidor_id INT REFERENCES servidores(id) ON DELETE CASCADE,
  membro_id INT REFERENCES membros(id) ON DELETE CASCADE,
  data_entrega TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20), -- pendente_aprovacao, aprovada, rejeitada
  data_aprovacao TIMESTAMP,
  aprovador_id VARCHAR(20),
  motivo_rejeicao TEXT,
  print_url TEXT
);

-- Tabela de Items Entregues
CREATE TABLE IF NOT EXISTS itens_entregues (
  id SERIAL PRIMARY KEY,
  entrega_id INT REFERENCES entregas_farm(id) ON DELETE CASCADE,
  item_nome VARCHAR(100),
  quantidade INT,
  meta_semanal INT
);

-- Tabela de ADVs (com servidor)
CREATE TABLE IF NOT EXISTS advs (
  id SERIAL PRIMARY KEY,
  servidor_id INT REFERENCES servidores(id) ON DELETE CASCADE,
  membro_id INT REFERENCES membros(id) ON DELETE CASCADE,
  numero_adv INT, -- 1 ou 2
  data_atribuicao TIMESTAMP DEFAULT NOW(),
  motivo VARCHAR(200)
);

-- Tabela de Configurações por Servidor
CREATE TABLE IF NOT EXISTS config_servidor (
  id SERIAL PRIMARY KEY,
  servidor_id INT UNIQUE REFERENCES servidores(id) ON DELETE CASCADE,
  config_json JSONB,
  data_atualizacao TIMESTAMP DEFAULT NOW()
);

-- Tabela de Logs (auditoria)
CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  servidor_id INT REFERENCES servidores(id) ON DELETE CASCADE,
  usuario_id VARCHAR(20),
  acao VARCHAR(100),
  descricao TEXT,
  data_log TIMESTAMP DEFAULT NOW()
);

-- Tabela de Histórico de Cargos (para rastreamento)
CREATE TABLE IF NOT EXISTS historico_cargos (
  id SERIAL PRIMARY KEY,
  servidor_id INT REFERENCES servidores(id) ON DELETE CASCADE,
  membro_id INT REFERENCES membros(id) ON DELETE CASCADE,
  cargo_nome VARCHAR(100),
  acao VARCHAR(20), -- 'adicionar', 'remover'
  data_acao TIMESTAMP DEFAULT NOW()
);

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_servidores_guild_id ON servidores(guild_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_chave ON api_keys(chave_token);
CREATE INDEX IF NOT EXISTS idx_api_keys_servidor ON api_keys(servidor_id);
CREATE INDEX IF NOT EXISTS idx_membros_guild_discord ON membros(servidor_id, discord_id);
CREATE INDEX IF NOT EXISTS idx_entregas_servidor ON entregas_farm(servidor_id);
CREATE INDEX IF NOT EXISTS idx_entregas_membro ON entregas_farm(membro_id);
CREATE INDEX IF NOT EXISTS idx_entregas_status ON entregas_farm(status);
CREATE INDEX IF NOT EXISTS idx_advs_servidor ON advs(servidor_id);
CREATE INDEX IF NOT EXISTS idx_advs_membro ON advs(membro_id);
CREATE INDEX IF NOT EXISTS idx_logs_servidor ON logs(servidor_id);
CREATE INDEX IF NOT EXISTS idx_historico_servidor ON historico_cargos(servidor_id);
