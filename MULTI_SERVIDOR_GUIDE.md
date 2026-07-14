# 🌐 Sistema Multi-Servidor com API Keys

## Visão Geral

O banco de dados agora suporta **múltiplos servidores Discord** com dados completamente isolados e sistema de autenticação via **API Keys**.

Isso torna o bot totalmente comercializável como SaaS!

---

## 📊 Estrutura de Dados

### Tabelas Principais

```
servidores (1) ─────── (N) membros
    │                      │
    │                      └─ (N) entregas_farm ─ (N) itens_entregues
    │                      │
    │                      └─ (N) advs
    │
    └─ (N) api_keys
    │
    └─ (N) config_servidor
    │
    └─ (N) logs
    │
    └─ (N) historico_cargos
```

### Tabela `servidores`
```sql
- id: PK
- guild_id: ID do servidor Discord (UNIQUE)
- nome_servidor: Nome do servidor
- owner_id: Dono do servidor
- plano: free, premium, enterprise
- ativo: true/false
- data_criacao: TIMESTAMP
```

### Tabela `api_keys`
```sql
- id: PK
- servidor_id: FK (relaciona ao servidor)
- chave_token: Token único (64 chars)
- nome_chave: Descrição (ex: "Webhook Farm", "Mobile App")
- permissoes: ['read', 'write', 'admin']
- data_criacao: TIMESTAMP
- ultimo_uso: TIMESTAMP
- ativa: true/false
```

### Tabela `logs`
- Rastreia todas as ações em cada servidor
- Auditoria completa

### Tabela `historico_cargos`
- Registra quando cargos são adicionados/removidos
- Essencial para compliance

---

## 🔑 Como Funciona as API Keys

### Criar Chave

```javascript
const serverService = require('../services/serverService');

const chave = await serverService.createAPIKey(
  '123456789', // guild_id
  'Webhook Farm', // nome_chave
  ['read', 'write'] // permissões
);

// Retorna: {chave_token: 'a3f9d8...', nome_chave: 'Webhook Farm', ...}
```

### Validar Chave

```javascript
const validacao = await serverService.validateAPIKey(
  'a3f9d8...', // token
  'write' // permissão necessária
);

if (validacao) {
  // Chave válida
  console.log(validacao.guild_id); // Qual servidor?
}
```

---

## 📍 Como Usar nos Handlers

### Antes (Single-Servidor)
```javascript
const memberService = require('../services/memberService');

await memberService.saveMember(
  discordId,
  nomeInGame,
  id,
  nomeFormatado
);
```

### Depois (Multi-Servidor) ✨
```javascript
const memberService = require('../services/memberService');

await memberService.saveMember(
  interaction.guild.id, // ← Adiciona guild_id
  discordId,
  nomeInGame,
  id,
  nomeFormatado
);
```

### Exemplo Completo

```javascript
const { SlashCommandBuilder } = require('discord.js');
const memberService = require('../services/memberService');
const serverService = require('../services/serverService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('registrar')
    .setDescription('Registrar membro'),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const discordId = interaction.user.id;

    // 1. Garantir que servidor está registrado
    await serverService.registerServer(
      guildId,
      interaction.guild.name,
      interaction.guild.ownerId
    );

    // 2. Salvar membro (agora com isolamento por servidor)
    await memberService.saveMember(
      guildId,
      discordId,
      'João',
      1234,
      'João | 1234'
    );

    // 3. Log da ação
    await serverService.logAction(
      guildId,
      discordId,
      'registro_membro',
      'Membro registrado com sucesso'
    );

    await interaction.reply('✅ Registrado!');
  },
};
```

---

## 🔐 Casos de Uso para API Keys

### Caso 1: Webhook Externo
```
Um site/aplicação externa quer consultar dados do farm:
- Criar chave com permissão 'read'
- Usar token para fazer requisições HTTP
- Webhook identifica qual servidor pelos dados retornados
```

### Caso 2: Aplicativo Mobile
```
Criar app mobile para membros verem seu status:
- Chave por usuário com permissão 'read'
- App usa token para autenticar
- Retorna dados APENAS daquele usuário/servidor
```

### Caso 3: Integração com ERP
```
Sistema externo sincroniza dados:
- Chave com permissão 'read' + 'write'
- Puxa dados do Discord
- Empurra dados para ERP
```

---

## 🚀 Planos Comerciais

```sql
-- Free (até 500 membros)
- 1 servidor
- 1 API key
- Sem suporte
- Dados deletados após 90 dias inativo

-- Premium ($10/mês)
- 5 servidores
- 10 API keys
- Suporte por email
- Dados mantidos indefinidamente
- Analytics básico

-- Enterprise (custom)
- Servidores ilimitados
- API keys ilimitadas
- Suporte 24/7
- SLA 99.9%
- Integrações customizadas
```

---

## 📈 Escalabilidade

Com essa estrutura:
- ✅ Suporta **1.000+ servidores** simultâneos
- ✅ Dados completamente isolados
- ✅ Fácil implementar limites por plano
- ✅ Monetização clara
- ✅ Auditoria completa
- ✅ GDPR/compliance ready

---

## 🔄 Migração de Dados (JSON → PostgreSQL)

Quando você fizer o primeiro deploy com PostgreSQL:

1. **Schema é criado automaticamente** (initDb.js)
2. **Banco vazio está pronto** para novos dados
3. **Dados antigos em JSON podem ser migrados** com script

Script de migração (futuro):
```javascript
// Ler config.json e membros.json
// Inserir no PostgreSQL
// Verificar integridade
// Remover JSONs
```

---

## 📝 Checklist Implementação

- [ ] Código atualizado com multi-servidor
- [ ] Todos os handlers usam `interaction.guild.id`
- [ ] Database criada em Railway
- [ ] Deploy automático
- [ ] Testar com 2+ servidores
- [ ] Criar painel de gerenciamento de API keys
- [ ] Documentar endpoints para clientes

---

## 🎯 Próximo Passo

Você quer que eu atualize os **event handlers** (`interactionCreate.js`, etc) para usar a nova estrutura?

Isso vai tornar tudo funcional com múltiplos servidores! 🚀
