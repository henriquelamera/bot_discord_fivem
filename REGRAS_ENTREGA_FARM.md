# 🌾 Regras de Entrega de Farm

## 📋 Visão Geral

Sistema automatizado de farm onde membros entregam itens farmados semanalmente. O bot gerencia cargos, ADVs (advertências) e calcula automaticamente se as metas foram atingidas.

---

## 🎯 Sistema de Metas

### Meta Semanal por Item
- Cada item tem uma meta semanal configurável
- **Exemplo:**
  - Maconha: 300/semana
  - Cocaína: 200/semana
  - MDMA: 150/semana

### Deadline
- **Toda segunda-feira às 00:00** o sistema verifica quem entregou
- Se não entregou → ganha ADV

---

## ⚠️ Sistema de ADVs (Advertências)

### Limite Máximo: 2 ADVs

| Situação | Ação do Bot | Cargo | Status |
|----------|-----------|-------|--------|
| 1ª semana sem entrega | Adiciona ADV 1 | `Farm Atrasado` + `ADV Farm 1` | ⚠️ Atrasado |
| 2ª semana sem entrega | Adiciona ADV 2 | `Farm Atrasado` + `ADV 1` + `ADV 2` | 🚨 Máximo |
| 3ª+ semana sem entrega | PARA (notifica responsáveis) | Pode resultar em **PD** | ❌ Crítico |

### Notificação de 2 ADVs
Quando atinge 2 ADVs:
- 💬 Membro recebe DM alertando que está sujeito a **PD (Punição da Organização)**
- 📢 Responsáveis de farm são notificados no Discord

---

## 📦 Fluxo de Entrega

### Passo 1: Membro Abre Baú
```
Membro clica "📦 Abrir Baú"
↓
Bot cria canal privado: #farm-{nome}
↓
Membro vê botão "📦 Entregar Meta"
```

### Passo 2: Membro Entrega Meta
```
Membro clica "📦 Entregar Meta"
↓
Modal aparece com campos para cada item
↓
Membro preenche:
  - Quantidade de cada item
  - Link do print (comprovação/screenshot)
↓
Clica "Entregar"
```

**Exemplo de Entrega:**
```
Maconha: 300
Cocaína: 200
MDMA: 150
Print: https://imgur.com/abc123
```

### Passo 3: Aprovação
```
Notificação aparece em #farm-aprovacoes
↓
Gerente clica ✅ Aprovar ou ❌ Recusar
↓
Sistema calcula automaticamente
```

---

## 💰 Sistema de Pagamento de ADVs

### Como Funciona

O bot calcula **quanto é devido** vs **quanto foi entregue**:

```
Se tem 2 ADVs = deve 2 semanas de cada item
Se tem 1 ADV = deve 1 semana de cada item
```

### Exemplos Práticos

#### Exemplo 1: Pagamento Parcial
```
Meta: Maconha 300/semana
Pessoa: 2 ADVs (deve 600)
Entrega: 300 de Maconha

Resultado:
✅ 1 ADV removido
❌ Faltam ainda 300 de Maconha
```

#### Exemplo 2: Pagamento Total
```
Meta: Maconha 300/semana
Pessoa: 2 ADVs (deve 600)
Entrega: 600 de Maconha

Resultado:
✔️ Todos os 2 ADVs removidos!
🎉 Pessoa voltou para "Farm em Dia"
```

#### Exemplo 3: Múltiplos Itens
```
Metas: 
  - Maconha: 300/semana
  - Cocaína: 200/semana

Pessoa: 2 ADVs (deve 600 maconha + 400 cocaína)
Entrega: 600 maconha + 200 cocaína

Resultado:
⚠️ 1 ADV removido (pagou 1 semana)
❌ Faltam ainda: 400 de Cocaína
```

---

## 🎖️ Cargos de Farm

### Cargos Automáticos

| Cargo | Significado | Quando Recebe |
|-------|-----------|---------------|
| `Farm em Dia` | ✅ Entregou meta | Após entrega aprovada com 0 ADVs |
| `Farm Atrasado` | ❌ Não entregou | Cron job na segunda-feira |
| `ADV Farm 1` | 1ª advertência | 1ª semana sem entrega |
| `ADV Farm 2` | 2ª advertência | 2ª semana sem entrega |
| `Baú Aberto` | Pode entregar farm | Ao abrir baú |

### Cargos Manuais

| Cargo | Função |
|-------|--------|
| `Gerente de Farm` | Aprova/rejeita entregas |
| `Responsáveis por Farm` | Recebe notificações críticas |

---

## ✅ Aprovação de Entrega

### Se Aprovar ✅

O bot **automaticamente**:
1. ✔️ Remove ADVs (proporcionalmente)
2. ✔️ Remove cargo "Farm Atrasado" (se zerou ADVs)
3. ✔️ Adiciona cargo "Farm em Dia" (se zerou ADVs)
4. 💬 Envia DM ao membro com status
5. 📊 Salva data e hora da aprovação

**Mensagem ao Membro:**
```
✅ Sua entrega foi aprovada!

✔️ Pagamento Total: 1 ADV removido!
📋 Você ainda deve: 300 de Maconha
```

### Se Recusar ❌

O bot **automaticamente**:
1. Abre modal para digitar motivo
2. Envia DM ao membro com o motivo
3. ❌ Não remove ADVs
4. Membro pode fazer nova entrega

**Exemplo de Rejeição:**
```
❌ Sua entrega foi RECUSADA

Motivo: Print não está visível, tente novamente com melhor qualidade
```

---

## 📊 Resumo Semanal

### O que Acontece Toda Segunda às 00:00

```
Bot verifica todos com "Farm em Dia"
↓
Para cada pessoa:
  ├─ Procura entrega aprovada na semana passada
  │
  ├─ Se ENTREGOU:
  │  └─ Mantém "Farm em Dia"
  │
  └─ Se NÃO ENTREGOU:
     ├─ Remove "Farm em Dia"
     ├─ Adiciona "Farm Atrasado"
     └─ Adiciona ADV (1ª, 2ª ou notifica)
```

---

## 🔧 Configurações Necessárias

### Itens de Farm
- [ ] Maconha
- [ ] Cocaína
- [ ] MDMA
- [ ] *(adicione outros conforme necessário)*

### Metas Semanais
- [ ] Definir meta para cada item
- [ ] Exemplo: Maconha = 300/semana

### Cargos
- [ ] `Farm em Dia`
- [ ] `Farm Atrasado`
- [ ] `ADV Farm 1`
- [ ] `ADV Farm 2`
- [ ] `Gerente de Farm` (aprovador)
- [ ] `Responsáveis por Farm` (notificações)

### Canais
- [ ] `#farm-baus` (categoria para canais privados)
- [ ] `#farm-aprovacoes` (notificações de entrega)

---

## 📝 Checklist para o Gerente

- [ ] Entendi como funciona o sistema de metas
- [ ] Entendi o limite de 2 ADVs
- [ ] Entendi como funciona o pagamento proporcional
- [ ] Entendi o fluxo de aprovação/rejeição
- [ ] Entendi que o cron job roda toda segunda às 00:00
- [ ] Todas as configurações foram feitas
- [ ] Pronto para começar a receber entregas

---

## ❓ Perguntas Frequentes

**P: E se a pessoa entregar fora do prazo?**
R: Não há prazo específico dentro da semana. Pode entregar qualquer dia, mas deve ter entregado até segunda às 00:00.

**P: Pode entregar mais de uma vez na semana?**
R: Sim! Cada entrega é processada independentemente. Se entregar 300 uma vez e 300 outra, totalizou 600.

**P: O que acontece com os dados de entrega?**
R: Todos os históricos são salvos no bot com data, hora, aprovador e status.

**P: Como rejeitar sem ser rude?**
R: Use um motivo construtivo. Ex: "Print não está claro, tente com melhor iluminação" ao invés de "Print ruim".

**P: Pode resetar os ADVs manualmente?**
R: Sim, admin pode remover os cargos de ADV manualmente se necessário.

---

## 🎮 Próximos Passos

1. **Gerente aprova as regras** ✅
2. **Configurar itens e metas** 
3. **Criar cargos no Discord**
4. **Publicar botão de "Abrir Baú"** em canal público
5. **Testar com um membro**
6. **Treinar gerentes sobre aprovação/rejeição**

---

**Status:** ⏳ Aguardando aprovação do Gerente de Farm
