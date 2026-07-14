# 🚀 Guia de Teste Rápido - Sistema de Farm

## ⏱️ Tempo Estimado: 10 minutos

### 1️⃣ Criar Cargos (1 minuto)

No Discord, crie esses cargos:
1. `Farm em Dia`
2. `Farm Atrasado`
3. `ADV Farm 1`
4. `ADV Farm 2`
5. `Gerente de Farm`

**Importante:** Os cargos devem estar ABAIXO do cargo do bot na hierarquia!

---

### 2️⃣ Criar Canais (1 minuto)

Crie esses canais:
1. `#farm-baus` (categoria)
   - Será usado para os baús privados
   
2. `#farm-aprovacoes` (canal de texto)
   - Receberá as notificações de entrega

---

### 3️⃣ Configurar no Bot (5 minutos)

Execute NESSA ORDEM:

#### Passo 1: Configurar Farm
```
/painel_configuracao
👆 Clique em "🌾 Farm"
   ↓
👆 Clique em "Categoria de Farm" → Selecione #farm-baus
   ↓
👆 Clique em "Criar Itens" → Digite: Maconha (pode adicionar mais depois)
   ↓
👆 Clique em "Canal de Aprovações" → Selecione #farm-aprovacoes
```

#### Passo 2: Configurar Cargos
```
/admin_bot
👆 Clique em "🌾 Cargos Farm"
   ↓
Para CADA opção abaixo, selecione o cargo correspondente:
   ├─ Farm em Dia → Selecione "Farm em Dia"
   ├─ Farm Atrasado → Selecione "Farm Atrasado"
   ├─ ADV Farm 1 → Selecione "ADV Farm 1"
   ├─ ADV Farm 2 → Selecione "ADV Farm 2"
   ├─ Pagamento → Selecione "Gerente de Farm" (quem aprova)
   └─ Responsáveis por Farm → Selecione "Gerente de Farm"
```

---

### 4️⃣ Testar Fluxo Completo (3 minutos)

#### Teste A: Entrega e Aprovação

1. **Dar cargo ao membro de teste:**
   - Atribua "Morador" ao membro
   - Atribua "Farm em Dia" ao membro

2. **Membro testa:**
   - Membro vai em DM com bot
   - Clica "📦 Abrir Baú"
   - Clica "📦 Entregar Meta"
   - Preenche: `50` de Maconha + cola um link (ex: https://imgur.com/123)
   - Clica "Entregar"

3. **Verificar:**
   - ✅ Bot criou canal privado `farm-username`
   - ✅ Notificação apareceu em `#farm-aprovacoes` com 2 botões

4. **Aprovar:**
   - Clique em "✅ Aprovar"
   - Sistema deve remover ADV (se tiver) e adicionar Farm em Dia

#### Teste B: Rejeição

1. **Novo membro testa entrega:**
   - Repita passos do Teste A (2-3)

2. **Rejeitar:**
   - Clique em "❌ Recusar"
   - Digite motivo: "Print não está visível"
   - Bot deve enviar DM ao membro com motivo

#### Teste C: Limite de ADVs

1. **Dar ADVs ao membro:**
   - Use comando manual: `/cargo_add @membro Farm Atrasado`
   - Use comando manual: `/cargo_add @membro ADV Farm 1`
   - Use comando manual: `/cargo_add @membro ADV Farm 2`

2. **Membro tenta entregar:**
   - Membro faz nova entrega
   - Clica "✅ Aprovar"
   - **Resultado esperado:**
     - ⚠️ Mensagem: "Porém, está com 2 ADVs (máximo)"
     - 💬 Membro recebe DM: "Você está sujeito a PD"
     - 📢 Gerente recebe notificação

---

### 5️⃣ Verificar Tudo Funcionando

| Teste | Esperado | Status |
|-------|----------|--------|
| Abrir Baú cria canal | ✅ Canal privado criado | |
| Modal de entrega | ✅ Aparece com campos corretos | |
| Notificação em #farm-aprovacoes | ✅ Embed com botões | |
| Aprovar com 0 ADVs | ✅ Add Farm em Dia, Remove Atrasado | |
| Aprovar com 1 ADV | ✅ Remove ADV 1, Add Farm em Dia | |
| Aprovar com 2 ADVs | ✅ Para e notifica responsáveis | |
| Rejeitar | ✅ Membro recebe motivo em DM | |

---

## 🔧 Dúvidas Comuns Durante Testes

**P: Modal não aparece quando clico em "Entregar Meta"**
- R: Confirme que items foram cadastrados em "Criar Itens"

**P: Bot não cria canal privado**
- R: Confirme que categoria #farm-baus foi selecionada

**P: Notificação não aparece em #farm-aprovacoes**
- R: Confirme que canal foi selecionado em "Canal de Aprovações"

**P: Membro não recebe DM**
- R: Membro pode ter DMs bloqueadas; configure no Discord

**P: Cargos não sendo adicionados/removidos**
- R: Confirme que bot está ACIMA dos cargos na hierarquia

---

## 📋 Checklist de Teste

- [ ] Cargos criados
- [ ] Canais criados
- [ ] `/painel_configuracao` executado
- [ ] `/admin_bot` executado
- [ ] Item "Maconha" cadastrado
- [ ] Teste A (Entrega/Aprovação) OK
- [ ] Teste B (Rejeição) OK
- [ ] Teste C (Limite ADVs) OK
- [ ] Tabela de verificação preenchida

---

## ✅ Quando Tudo Estiver OK

Se todos os testes passarem, o sistema está **100% funcional**!

Próximos passos opcionais:
- [ ] Adicionar mais items de farm
- [ ] Configurar metas semanais
- [ ] Testar cron job (esperar segunda 00:00 ou simular)

---

**Boa sorte com os testes! 🎮**
