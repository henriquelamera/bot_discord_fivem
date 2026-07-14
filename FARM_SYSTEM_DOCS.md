# 🌾 Sistema de Farm - Documentação Completa

## 📋 Índice
1. [Visão Geral](#visão-geral)
2. [Configuração Inicial](#configuração-inicial)
3. [Fluxo Operacional](#fluxo-operacional)
4. [Sistema de ADVs](#sistema-de-advs)
5. [Arquivos Modificados](#arquivos-modificados)
6. [Estrutura de Dados](#estrutura-de-dados)
7. [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

O sistema de Farm permite que membros façam entrega de itens farmados, com um processo de aprovação que gerencia cargos automáticamente baseado em:
- **Entregas aprovadas** → Farm em Dia
- **Entregas não feitas** → Farm Atrasado + ADVs
- **Limite de 2 ADVs** → Notificação de PD para responsáveis

---

## ⚙️ Configuração Inicial

### 1. Criar Cargos no Servidor Discord

Execute esses passos **no servidor Discord** (criar roles):
- `Farm em Dia` - Cargo base para quem está em dia
- `Farm Atrasado` - Cargo para quem não entregou
- `ADV Farm 1` - 1ª advertência
- `ADV Farm 2` - 2ª advertência (máximo antes de PD)
- `Gerente de Farm` (opcional) - Responsável por farm

### 2. Configurar via Comandos do Bot

Execute os comandos **EM ORDEM**:

#### A) Configure o Painel de Farm
```
/painel_configuracao
└─ 🌾 Farm
   ├─ Categoria de Farm (selecione a categoria para os baús)
   ├─ Criar Itens (ex: Maconha, Cocaína, MDMA, etc.)
   └─ Canal de Aprovações (selecione o canal #farm-aprovacoes)
```

#### B) Configure os Cargos de Farm
```
/admin_bot
└─ 🌾 Cargos Farm
   ├─ Farm em Dia (selecione o cargo criado)
   ├─ Farm Atrasado (selecione o cargo criado)
   ├─ ADV Farm 1 (selecione o cargo criado)
   ├─ ADV Farm 2 (selecione o cargo criado)
   ├─ Pagamento (Aprovadores) (selecione quem pode aprovar)
   └─ Responsáveis por Farm (selecione gerentes)
```

---

## 🔄 Fluxo Operacional

### Etapa 1: Membro Entrega Farm

```
[Membro recebe cargo "Morador"]
        ↓
[Membro clica "📦 Abrir Baú" (em DM)]
        ↓
[Bot cria: canal privado farm-{username}]
        ↓
[Membro clica "📦 Entregar Meta"]
        ↓
[Modal aparece com:]
  - Campo para cada item cadastrado
  - Campo para link do print (comprovação)
        ↓
[Membro preenche e submete]
```

**Exemplo de Modal:**
```
Item: Maconha
Campo: 50 (quantidade)

Item: Cocaína  
Campo: 25 (quantidade)

Link do Print:
https://imgur.com/abcd1234
```

### Etapa 2: Aprovadores Recebem Notificação

```
[Bot salva entrega]
        ↓
[Bot busca canal configurado em "Canal de Aprovações"]
        ↓
[Bot envia embed com:]
  - Nome do membro
  - Data/hora
  - Items e quantidades
  - Link do print
  - 2 botões: ✅ Aprovar | ❌ Recusar
```

### Etapa 3: Aprovador Toma Decisão

#### ✅ Se APROVAR:

```
Fluxo de Remoção de ADVs:
┌─────────────────────────────────┐
│ Membro tem ADVs?                │
└────────────┬────────────────────┘
             │
    ┌────────▼────────┐
    │                 │
   NÃO                SIM
    │                 │
    │         ┌───────▼─────────┐
    │         │ Tem 2 ADVs?     │
    │         └───┬───────────┬─┘
    │            NÃO         SIM
    │             │           │
    │         ┌───▼──────┐    │
    │         │ Tem 1?   │    │
    │         └─┬──────┬─┘    │
    │          NÃO    SIM     │
    │           │      │      │
    │           │      │      │
    │        [OK]   [Rem]  [NOTIFICA]
    │           │      │      │
    │           └──┬───┴──────┘
    │              │
    └──────────────▼──────────────┘
         
[Se sem ADVs:]
❌ Remove "Farm Atrasado"
✔️ Adiciona "Farm em Dia"

[Se com 2 ADVs:]
⚠️ PARA aqui
📢 Notifica "Responsáveis por Farm"
💬 DM ao membro: "Você está sujeito a PD"
```

#### ❌ Se RECUSAR:

```
[Aprovador clica "Recusar"]
        ↓
[Modal aparece: "Motivo da rejeição"]
        ↓
[Aprovador digita motivo]
        ↓
[Bot envia DM ao membro com motivo]
        ↓
[Membro pode fazer nova entrega]
```

### Etapa 4: Cron Job (Toda Segunda às 00:00)

```
┌─ Busca todos com "Farm em Dia"
│
└─ Para cada membro:
   ├─ Procura entrega aprovada na semana passada
   │
   ├─ Se NÃO encontrou:
   │  ├─ Remove "Farm em Dia"
   │  ├─ Adiciona "Farm Atrasado"
   │  └─ Adiciona ADV (respeitando limite de 2)
   │     ├─ 1ª vez sem entrega → ADV Farm 1
   │     ├─ 2ª vez sem entrega → ADV Farm 2
   │     └─ 3ª+ vez → PARA e notifica responsáveis
   │
   └─ Se encontrou:
      └─ Mantém "Farm em Dia"
```

---

## ⚠️ Sistema de ADVs

### Limite: 2 ADVs Máximo

| Situação | Ação | Resultado |
|----------|------|-----------|
| Não entrega (sem ADV) | Cron adiciona ADV 1 | `Farm Atrasado` + `ADV Farm 1` |
| Não entrega (com ADV 1) | Cron adiciona ADV 2 | `Farm Atrasado` + `ADV 1` + `ADV 2` |
| Não entrega (com ADV 1+2) | Cron PARA | ❌ Para, notifica responsáveis |
| Entrega (com ADV) | Aprova, remove 1 ADV | Perde 1 ADV, mantém Farm Atrasado |
| Entrega (com ADV 1 apenas) | Aprova | Perde ADV 1, ganha Farm em Dia ✅ |

### Notificação de Máximo

Quando membro atinge 2 ADVs:

**Para o Membro:**
```
🚨 Você atingiu o LIMITE de 2 ADVs!

Você está SUJEITO A PD (Punição da Organização).

Procure imediatamente os responsáveis pelo farm
para resolver sua situação!
```

**Para Responsáveis:**
```
Embed no canal:
⚠️ Membro com 2 ADVs de Farm
👤 @Username está com 2 ADVs e sujeito a PD
```

---

## 📁 Arquivos Modificados

### 1. `src/events/interactionCreate.js`

**Handlers Adicionados:**
- `entregar_meta` - Abre modal de entrega
- `modal_entregar_meta` - Processa entrega + notifica aprovadores
- `aprovar_farm_*` - Aprova e remove ADV (com limite de 2)
- `recusar_farm_*` - Abre modal de motivo
- `modal_recusar_farm_*` - Processa rejeição
- `select_canal_aprovacoes` - Configura canal
- `painel_cargos_farm` - Mostra opções de cargos
- Handlers para `select_cargo_*` - Salva configuração

**Mudanças:**
- Adicionado suporte a cargos únicos (cargo_em_dia, cargo_atrasado, etc.)
- Limite de 2 ADVs implementado
- Notificação de responsáveis quando atinge máximo

### 2. `src/events/ready.js`

**Mudança:**
```javascript
const { initFarmCron } = require('../jobs/farmCron');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Bot online como ${client.user.tag}`);
    initFarmCron(client); // Ativa cron job
  },
};
```

### 3. `src/jobs/farmCron.js` (NOVO)

**Funcionalidade:**
- Executa toda segunda às 00:00
- Verifica entregas da semana
- Atualiza cargos com limite de 2 ADVs
- Notifica membros e responsáveis

---

## 📊 Estrutura de Dados

### config.json - Farm Object

```json
{
  "farm": {
    "cargo_em_dia_id": "123456789",
    "cargo_atrasado_id": "987654321",
    "cargo_adv_1": "111111111",
    "cargo_adv_2": "222222222",
    "cargo_pagamento": ["333333333", "444444444"],
    "cargo_responsaveis_farm": ["555555555"],
    "canal_aprovacoes_id": "666666666",
    "categoria_bau_id": "777777777",
    "itens": [
      {
        "id": "maconha",
        "nome": "Maconha"
      },
      {
        "id": "cocaina",
        "nome": "Cocaína"
      }
    ],
    "entregas": [
      {
        "id": "1720000000000",
        "usuario_id": "123456789",
        "usuario_tag": "User#1234",
        "data_entrega": "2024-07-10T15:30:00.000Z",
        "itens": {
          "maconha": { "nome": "Maconha", "quantidade": 50 },
          "cocaina": { "nome": "Cocaína", "quantidade": 25 }
        },
        "print_url": "https://imgur.com/image.png",
        "status": "pendente_aprovacao",
        "data_aprovacao": "2024-07-10T16:00:00.000Z",
        "aprovador_id": "987654321",
        "motivo_rejeicao": null
      }
    ]
  }
}
```

### Status de Entrega

- `pendente_aprovacao` - Aguardando revisão
- `aprovada` - Processada com sucesso
- `rejeitada` - Recusada com motivo

---

## 📈 Exemplo Completo de Fluxo Semanal

### Dia 1 (Segunda) - Semana 1

```
Membro recebe "Morador" + "Farm em Dia"
(entregou bem semana passada)
```

### Dia 5 (Sexta) - Semana 1

```
Membro clica "Abrir Baú" → "Entregar Meta"
Preenche: 50 Maconha + 25 Cocaína + print
Clica "Entregar"

Aprovador recebe notificação
Clica "Aprovar"

Sistema: Remove ADV? (Não tem)
Sistema: Mantém "Farm em Dia"
```

### Próxima Segunda (00:00) - Semana 2

```
Cron verifica: Tem entrega aprovada semana passada?
SIM ✅ → Mantém "Farm em Dia"
```

### Dia 5 (Sexta) - Semana 2

```
Membro NÃO entrega
```

### Próxima Segunda (00:00) - Semana 3

```
Cron verifica: Tem entrega aprovada semana passada?
NÃO ❌ → 
  ❌ Remove "Farm em Dia"
  ✔️ Adiciona "Farm Atrasado"
  ⚠️ Adiciona "ADV Farm 1"
  💬 Envia DM: "Você não entregou! Tem ADV 1"
```

### Dia 5 (Sexta) - Semana 3

```
Membro ENTREGA (para pagar dívida anterior)

Aprovador aprova:
Sistema:
  - Remove "ADV Farm 1"
  - Remove "Farm Atrasado" (já que sem ADVs)
  - Adiciona "Farm em Dia"
  💬 DM: "Aprovada! Seu status foi restaurado"
```

### Próxima Segunda (00:00) - Semana 4

```
Cron verifica: Tem entrega aprovada semana passada?
SIM ✅ → Mantém "Farm em Dia"
```

---

## 🔍 Troubleshooting

### ❌ "Canal de aprovações não configurado"
**Solução:** Execute `/painel_configuracao` → 🌾 Farm → Canal de Aprovações

### ❌ "Nenhum cargo de aprovação foi configurado"
**Solução:** Execute `/admin_bot` → 🌾 Cargos Farm → Pagamento (Aprovadores)

### ❌ "Cargos de farm não configurados corretamente"
**Solução:** Certifique que configurou todos os 5 cargos:
- Farm em Dia
- Farm Atrasado
- ADV Farm 1
- ADV Farm 2
- Responsáveis por Farm (opcional mas recomendado)

### ❌ Membro não recebe DM
**Motivo:** DMs bloqueadas no servidor
**Solução:** Membro deve permitir DMs de membros do servidor

### ❌ Cron não está executando
**Verificação:**
1. Confirme que o bot online está escutando segundas às 00:00 UTC
2. Verifique console do bot por mensagens de erro
3. Confirme que os cargos estão corretamente configurados

### ⚠️ Membro com 2 ADVs não está sendo notificado
**Verificação:**
1. Confirme "Responsáveis por Farm" está configurado
2. Verifique se o canal de aprovações está acessível
3. Confirme que pelo menos um responsável tem o cargo

---

## 📝 Checklist de Verificação

- [ ] Todos os 4 cargos criados no Discord
- [ ] `/painel_configuracao` configurado (categoria + canal)
- [ ] `/admin_bot` configurado (todos os 5 cargos)
- [ ] Items cadastrados em "Criar Itens"
- [ ] Bot tem permissão de gerenciar cargos
- [ ] Bot tem permissão de criar canais
- [ ] Bot tem permissão de enviar mensagens em DM
- [ ] Pelo menos um membro tem cargo de "Pagamento" (aprovador)
- [ ] Pelo menos um membro tem "Responsáveis por Farm" (gerente)

---

## 🆘 Suporte

Para erros ou dúvidas:
1. Verifique o console do bot
2. Verifique se os cargos estão com IDs corretos em `config.json`
3. Confirme que os cargos têm hierarquia correta (bot acima deles)

**Exemplo de config.json correto:**
```json
{
  "farm": {
    "cargo_em_dia_id": "ID_AQUI",
    "cargo_atrasado_id": "ID_AQUI",
    "cargo_adv_1": "ID_AQUI",
    "cargo_adv_2": "ID_AQUI",
    "cargo_pagamento": ["ID1", "ID2"],
    "cargo_responsaveis_farm": ["ID1"],
    "canal_aprovacoes_id": "ID_AQUI",
    "categoria_bau_id": "ID_AQUI"
  }
}
```

---

**Documentação Atualizada:** 2024-07-10  
**Versão:** 2.0 (Com Sistema de 2 ADVs)
