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
  numero_adv INT, -- 1, 2 ou 3 (nível do ADV geral - config.advs, diferente do ADV Farm)
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

-- Tabela de Parcerias
CREATE TABLE IF NOT EXISTS parcerias (
  id SERIAL PRIMARY KEY,
  servidor_id INT REFERENCES servidores(id) ON DELETE CASCADE,
  registrado_por_id VARCHAR(20) NOT NULL,
  responsavel_outra_faccao VARCHAR(150) NOT NULL,
  nome_faccao VARCHAR(150) NOT NULL,
  produto VARCHAR(150) NOT NULL,
  nome_darkchat VARCHAR(150),
  senha_darkchat VARCHAR(150),
  print_parceria_url TEXT,
  print_mapa_url TEXT,
  canal_id VARCHAR(20),
  mensagem_id VARCHAR(20),
  data_registro TIMESTAMP DEFAULT NOW()
);

-- Colunas de darkchat adicionadas depois - ALTER separado pra quem já tinha
-- a tabela criada sem elas (CREATE TABLE IF NOT EXISTS não adiciona coluna
-- em tabela existente)
ALTER TABLE parcerias ADD COLUMN IF NOT EXISTS nome_darkchat VARCHAR(150);
ALTER TABLE parcerias ADD COLUMN IF NOT EXISTS senha_darkchat VARCHAR(150);

-- Tabela de Vendas Registradas (pela calculadora web)
CREATE TABLE IF NOT EXISTS vendas_registradas (
  id SERIAL PRIMARY KEY,
  servidor_id INT REFERENCES servidores(id) ON DELETE CASCADE,
  produto_id VARCHAR(100),
  produto_nome VARCHAR(150) NOT NULL,
  tipo VARCHAR(20) NOT NULL, -- 'pista' ou 'parceria'
  quantidade INT NOT NULL,
  preco_unitario NUMERIC(12,2) NOT NULL,
  valor_total NUMERIC(12,2) NOT NULL,
  parceria_id INT REFERENCES parcerias(id) ON DELETE SET NULL, -- parceria selecionada (opcional, só em vendas com parceria)
  faccao_nome VARCHAR(150), -- nome resolvido da parceria selecionada, ou digitado livre (pista) - pode ficar vazio mesmo em venda de parceria
  registrado_por VARCHAR(150), -- nome exibido do Discord no momento da venda (via sessão verificada)
  data_registro TIMESTAMP DEFAULT NOW()
);

ALTER TABLE vendas_registradas ADD COLUMN IF NOT EXISTS parceria_id INT REFERENCES parcerias(id) ON DELETE SET NULL;
ALTER TABLE vendas_registradas ADD COLUMN IF NOT EXISTS registrado_por_discord_id VARCHAR(20);
-- Agrupa as linhas de uma mesma venda com varios produtos (uma linha por produto)
ALTER TABLE vendas_registradas ADD COLUMN IF NOT EXISTS venda_grupo_id VARCHAR(40);

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
CREATE INDEX IF NOT EXISTS idx_parcerias_servidor ON parcerias(servidor_id);
CREATE INDEX IF NOT EXISTS idx_vendas_registradas_servidor ON vendas_registradas(servidor_id);
CREATE INDEX IF NOT EXISTS idx_vendas_registradas_grupo ON vendas_registradas(venda_grupo_id);
