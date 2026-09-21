const { EmbedBuilder } = require('discord.js');
const { itensAtivosFarm } = require('./farmItens');

// Texto do aviso que fica fixado no canal de baú de cada pessoa. É montado
// a partir da config na hora, então metas novas aparecem em baú novo - mas
// a mensagem já postada num baú antigo continua com o texto da época em que
// foi enviada. É por isso que existe a ação de reenviar avisos no painel.
function montarInfoFarm(config) {
  const itens = itensAtivosFarm(config);
  const metas = config.farm?.metas || {};

  const itensComMeta = itens.filter((item) => metas[item.id]?.meta_semanal);
  if (itensComMeta.length === 0) return '';

  const listaMetas = itensComMeta
    .map((item) => `- **${item.nome}:** ${metas[item.id].meta_semanal}/semana`)
    .join('\n');

  return (
    `🎯 **METAS DE FARM:**\n${listaMetas}\n\n` +
    `⚠️ Todos os itens farmados devem ser entregues **juntos**, em uma única entrega (botão **Entregar Meta** no seu canal).\n\n` +
    `📦 **COMO ENTREGAR (siga essa ordem):**\n` +
    `1️⃣ Clique no botão **📦 Entregar Meta** abaixo\n` +
    `2️⃣ Preencha a quantidade de cada item no formulário\n` +
    `3️⃣ Só **depois** disso envie a foto do print aqui no canal, quando o bot pedir\n` +
    `❌ Mandar a foto direto sem clicar no botão primeiro **não conta como entrega**!\n\n` +
    `⏰ **PRAZO:** o farm é semanal. O prazo é verificado toda **segunda-feira às 00h**, considerando as entregas aprovadas nos últimos 7 dias.\n\n` +
    `🚨 **SE NÃO ENTREGAR NO PRAZO:**\n` +
    `- Perde o cargo **Farm em Dia** e recebe **Farm Atrasado**\n` +
    `- Recebe uma **ADV** (advertência)\n` +
    `- Ao atingir **2 ADVs**, fica sujeito a **PD** (Punição da Organização)\n\n`
  );
}

// Monta o embed completo mostrado ao abrir o baú (primeira vez ou canal
// recriado) - sempre com uniforme/regras/metas/prazo, pra manter a mensagem
// sempre completa independente do motivo de estar sendo enviada.
function montarEmbedBauAberto(config, member, ehPrimeiraVez, temCargoVisitante) {
  const rec_uniforme = config.recrutamento?.rec_canal_uniforme;
  const rec_regras_fac = config.recrutamento?.rec_canal_regras_fac;
  const rec_regras_cidade = config.recrutamento?.rec_canal_regras_cidade;

  let descricao = ehPrimeiraVez
    ? `🎉 **PARABÉNS!** Você abriu seu baú de farm!\n\n`
    : `📦 Aqui estão as informações do seu farm:\n\n`;

  if (ehPrimeiraVez && temCargoVisitante) {
    descricao += `✅ Você agora é um **Morador** oficial da fac!\n\n`;
  }

  if (rec_uniforme || rec_regras_fac || rec_regras_cidade) {
    descricao += `📋 **INFORMAÇÕES IMPORTANTES:**\n`;
    if (rec_uniforme) descricao += `👕 Veja os uniformes em <#${rec_uniforme}>\n`;
    if (rec_regras_fac) descricao += `📜 Leia as regras da fac em <#${rec_regras_fac}>\n`;
    if (rec_regras_cidade) descricao += `🏙️ Leia as regras da cidade em <#${rec_regras_cidade}>\n`;
    descricao += '\n';
  }

  descricao += montarInfoFarm(config);

  return new EmbedBuilder()
    .setTitle(ehPrimeiraVez ? '🎉 Bem-vindo(a) ao Baú!' : '📦 Seu Canal de Farm')
    .setColor(0xFFD700)
    .setDescription(descricao)
    .setFooter({ text: `Farm de ${member.displayName}` })
    .setTimestamp();
}

module.exports = { montarInfoFarm, montarEmbedBauAberto };
