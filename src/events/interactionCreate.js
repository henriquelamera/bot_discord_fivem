const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const memberService = require('../services/memberService');
const deliveryService = require('../services/deliveryService');
const advService = require('../services/advService');
const { dispatchButton, dispatchSelectMenu, dispatchModal } = require('../utils/handlerRegistry');
const { marcarAguardandoImagem, desmarcarAguardandoImagem } = require('../utils/entregaMetaTracker');

// Carregar todos os handlers registrados
require('../handlers/registerAllHandlers');

// Formata um valor em Real (ex: 18000 -> "R$ 18.000,00")
function formatarMoeda(valor) {
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Agrupa pagamentos de config.farm.entregas por usuário, somando o valor e
// contando quantos pagamentos cada um teve. `filtro` recebe o objeto
// `pagamento` de cada entrega e decide se ele entra na conta (ex: só
// "pago" na semana, ou só "pendente"). Retorna ordenado do maior pro menor.
function calcularPagamentosPorMembro(config, filtro) {
  const entregas = config.farm?.entregas || [];
  const porMembro = new Map();

  for (const entrega of entregas) {
    const pagamento = entrega.pagamento;
    if (!pagamento || !filtro(pagamento)) continue;

    const atual = porMembro.get(entrega.usuario_id) || { total: 0, qtd: 0 };
    atual.total += pagamento.valor_total || 0;
    atual.qtd++;
    porMembro.set(entrega.usuario_id, atual);
  }

  return [...porMembro.entries()]
    .map(([discordId, dados]) => ({ discordId, ...dados }))
    .sort((a, b) => b.total - a.total);
}

// Lista os IDs dos membros que têm um cargo (null se não configurado/não existir)
function listarIdsComCargo(guild, cargoId) {
  if (!cargoId) return null;
  const role = guild.roles.cache.get(cargoId);
  return role ? [...role.members.keys()] : null;
}

// Monta uma lista de menções pronta pra mandar numa mensagem, cortando antes
// de estourar o limite de caracteres do embed (com "e mais X" no final)
function formatarListaMembros(ids) {
  if (ids.length === 0) return 'Nenhum membro.';

  const LIMITE_CHARS = 3800;
  let texto = '';
  let contados = 0;

  for (const id of ids) {
    const linha = `<@${id}>\n`;
    if (texto.length + linha.length > LIMITE_CHARS) break;
    texto += linha;
    contados++;
  }

  if (contados < ids.length) {
    texto += `\n*... e mais ${ids.length - contados}*`;
  }

  return texto;
}

// Junta linhas de texto (ex: ranking) num bloco só, cortando antes de
// estourar o limite de caracteres do embed (com "e mais X" no final)
function formatarListaTruncada(linhas, limiteChars = 3500) {
  if (linhas.length === 0) return null;

  let texto = '';
  let contadas = 0;

  for (const linha of linhas) {
    const linhaComQuebra = `${linha}\n`;
    if (texto.length + linhaComQuebra.length > limiteChars) break;
    texto += linhaComQuebra;
    contadas++;
  }

  if (contadas < linhas.length) {
    texto += `\n*... e mais ${linhas.length - contadas}*`;
  }

  return texto;
}

// Monta o texto "Nome: quantidade" por item, um por linha
function formatarTotaisPorItem(totais) {
  if (totais.length === 0) return 'Nenhum item entregue ainda.';
  return totais.map((t) => `**${t.itemNome}:** ${t.total.toLocaleString('pt-BR')}`).join('\n');
}

// Atualiza o registro de uma entrega no canal privado da pessoa (o embed
// enviado na submissão) pra refletir o novo status - aprovada/recusada/paga -
// mantendo um histórico completo ali, não só a foto solta.
async function atualizarHistoricoEntregaFarm(guild, entrega, cor, statusTexto, camposExtras = []) {
  if (!entrega.historico_canal_id || !entrega.historico_mensagem_id) return;

  try {
    const canal = guild.channels.cache.get(entrega.historico_canal_id);
    if (!canal) return;

    const msg = await canal.messages.fetch(entrega.historico_mensagem_id);
    const embedAtual = msg.embeds[0];
    if (!embedAtual) return;

    const tituloBase = embedAtual.title?.replace(/\s+—.*$/, '').trim() || `📦 Entrega #${entrega.id}`;
    const embedAtualizado = EmbedBuilder.from(embedAtual)
      .setTitle(`${tituloBase} — ${statusTexto}`)
      .setColor(cor);

    if (camposExtras.length > 0) {
      embedAtualizado.addFields(...camposExtras);
    }

    await msg.edit({ embeds: [embedAtualizado] });
  } catch (err) {
    console.warn('Não foi possível atualizar histórico no canal da pessoa:', err.message);
  }
}

// Extrai o ID de um membro a partir de texto digitado (menção "<@id>" gerada
// pelo autocomplete do "@" do Discord, ou o ID numérico colado direto).
// Retorna null se não conseguir identificar - texto solto (nome/apelido)
// não é resolvido, pra evitar aplicar ADV na pessoa errada.
function extrairIdMembro(texto) {
  const match = texto.match(/<@!?(\d+)>/);
  if (match) return match[1];

  const limpo = texto.trim().replace(/^@/, '');
  if (/^\d{15,21}$/.test(limpo)) return limpo;

  return null;
}

// Monta as opções de tipo de ADV disponíveis pra selecionar, só com os
// cargos que realmente foram configurados (Cargos de Farm > ADV Farm 1/2)
function opcoesAdvConfiguradas(config, guild) {
  const opcoes = [];
  if (config.farm?.cargo_adv_1) {
    const role = guild.roles.cache.get(config.farm.cargo_adv_1);
    opcoes.push({ label: `ADV 1${role ? ' - ' + role.name : ''}`, value: '1' });
  }
  if (config.farm?.cargo_adv_2) {
    const role = guild.roles.cache.get(config.farm.cargo_adv_2);
    opcoes.push({ label: `ADV 2${role ? ' - ' + role.name : ''}`, value: '2' });
  }
  return opcoes;
}

// Calcula o valor a pagar de uma entrega (apenas itens elegíveis a pagamento)
// e publica o lançamento no canal de controle de pagamento, se configurado.
async function processarPagamentoFarm(config, guild, entrega, aprovadorId) {
  const pagamentos = config.farm?.pagamentos || {};
  const canalPagamentoId = config.farm?.canal_controle_pagamento_id;

  const itensPagos = [];
  let valorTotal = 0;

  for (const [itemId, entregaData] of Object.entries(entrega.itens || {})) {
    const pag = pagamentos[itemId];
    if (!pag) continue; // item não elegível a pagamento

    const quantidade = entregaData.quantidade || 0;
    const subtotal = quantidade * pag.valor_unidade;
    if (subtotal <= 0) continue;

    itensPagos.push({
      itemId,
      nome: entregaData.nome || pag.nome,
      quantidade,
      valor_unidade: pag.valor_unidade,
      subtotal,
    });
    valorTotal += subtotal;
  }

  if (valorTotal <= 0) return null;

  entrega.pagamento = {
    valor_total: valorTotal,
    itens: itensPagos,
    status: 'pendente',
    aprovador_id: aprovadorId,
    data_aprovacao: new Date().toISOString(),
  };

  if (!canalPagamentoId) return entrega.pagamento;

  const canal = guild.channels.cache.get(canalPagamentoId);
  if (!canal) return entrega.pagamento;

  const { ButtonBuilder, ButtonStyle } = require('discord.js');

  const listaItens = itensPagos
    .map((i) => `**${i.nome}:** ${i.quantidade} x ${formatarMoeda(i.valor_unidade)} = ${formatarMoeda(i.subtotal)}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`💰 Pagamento Pendente — Entrega #${entrega.id}`)
    .setColor(0xf1c40f)
    .addFields(
      { name: '👤 Farmou', value: `<@${entrega.usuario_id}> (${entrega.usuario_tag})`, inline: false },
      { name: '✅ Aprovado por', value: `<@${aprovadorId}>`, inline: false },
      { name: '📦 Itens', value: listaItens, inline: false },
      { name: '💵 Valor Total', value: formatarMoeda(valorTotal), inline: false }
    )
    .setFooter({ text: `ID da entrega: ${entrega.id}` })
    .setTimestamp();

  const botaoPagar = new ButtonBuilder()
    .setCustomId(`marcar_pago_${entrega.id}`)
    .setLabel('💰 Marcar como Pago')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(botaoPagar);

  try {
    const mensagem = await canal.send({ embeds: [embed], components: [row] });
    entrega.pagamento.canal_id = canalPagamentoId;
    entrega.pagamento.mensagem_id = mensagem.id;
  } catch (err) {
    console.error('Erro ao publicar controle de pagamento:', err.message);
  }

  return entrega.pagamento;
}

// Atualiza só nome/ID da pessoa (nickname + registro no banco), sem mexer
// em cargo nenhum - pra quando ela só quer corrigir os dados, mantendo o
// cargo atual da hierarquia.
async function atualizarDadosMembro(config, guild, userId, solicitacao) {
  const membro = await guild.members.fetch(userId);
  const nomeFormatado = `${solicitacao.nomeInGame} | ${solicitacao.id}`;
  await membro.setNickname(nomeFormatado).catch(() => {});

  if (!config.membros_info) config.membros_info = {};
  config.membros_info[userId] = {
    ...config.membros_info[userId],
    nomeInGame: solicitacao.nomeInGame,
    id: solicitacao.id,
  };

  await memberService.saveMember(guild.id, userId, solicitacao.nomeInGame, solicitacao.id, nomeFormatado).catch((err) => {
    console.warn('Erro ao sincronizar membro no banco:', err.message);
  });

  if (config.atualizacoes_hierarquia_pendentes) {
    delete config.atualizacoes_hierarquia_pendentes[userId];
  }

  await membro.user.send('✅ Seus dados (nome/ID) foram atualizados com sucesso!').catch(() => {});
}

// Concede uma promoção da hierarquia (Morador/Membro/Gerente/Liderança):
// atualiza nickname, remove qualquer cargo antigo da hierarquia, adiciona o
// cargo novo e limpa a solicitação pendente. `solicitacao` vem de
// config.atualizacoes_hierarquia_pendentes[userId].
async function concederPromocaoHierarquia(config, guild, userId, solicitacao, cargoNovoId, aprovadorId) {
  const membro = await guild.members.fetch(userId);
  const cargoNovo = guild.roles.cache.get(cargoNovoId);
  if (!cargoNovo) throw new Error('Cargo não encontrado no servidor.');

  const nomeFormatado = `${solicitacao.nomeInGame} | ${solicitacao.id}`;
  await membro.setNickname(nomeFormatado).catch(() => {});

  // Remover qualquer cargo antigo da hierarquia (de qualquer tier) antes de
  // adicionar o novo, já que Gerente/Liderança podem ter vários cargos possíveis.
  const cargosDaHierarquia = [
    config.cargo_morador_id,
    config.cargo_membro_id,
    ...(config.cargo_gerente_ids || []),
    ...(config.cargo_lideranca_ids || []),
  ].filter(Boolean);

  const cargosParaRemover = membro.roles.cache
    .filter(role => cargosDaHierarquia.includes(role.id) && role.id !== cargoNovoId)
    .map(role => role.id);

  if (cargosParaRemover.length > 0) {
    await membro.roles.remove(cargosParaRemover).catch(err => {
      console.warn('Erro ao remover cargo(s) antigo(s) da hierarquia:', err.message);
    });
  }

  await membro.roles.add(cargoNovo);

  if (!config.membros_info) config.membros_info = {};
  config.membros_info[userId] = {
    ...config.membros_info[userId],
    nomeInGame: solicitacao.nomeInGame,
    id: solicitacao.id,
  };

  await memberService.saveMember(guild.id, userId, solicitacao.nomeInGame, solicitacao.id, nomeFormatado).catch(err => {
    console.warn('Erro ao sincronizar membro no banco:', err.message);
  });

  await serverService.logAction(
    guild.id,
    aprovadorId,
    'promocao_hierarquia',
    `${membro.user.tag} promovido para ${cargoNovo.name}`
  );

  if (config.atualizacoes_hierarquia_pendentes) {
    delete config.atualizacoes_hierarquia_pendentes[userId];
  }

  await membro.user.send(`✅ Sua promoção para **${cargoNovo.name}** foi aprovada!`).catch(() => {});
}

// Monta o bloco de texto com metas de farm, prazo de entrega e as
// implicações de não entregar no prazo. Só lista itens com meta definida.
function montarInfoFarm(config) {
  const itens = config.farm?.itens || [];
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

// Acha o canal privado de farm de um usuário na categoria de baú, pela
// permissão específica dele no canal. Retorna null se não encontrar.
function buscarCanalFarmDoUsuario(guild, config, userId) {
  const categoriaBauId = config.farm?.categoria_bau_id;
  if (!categoriaBauId) return null;

  const categoria = guild.channels.cache.get(categoriaBauId);
  return categoria?.children.cache.find((ch) => ch.permissionOverwrites.cache.has(userId)) || null;
}

// Transforma um nome em um slug válido de canal do Discord. Nomes com fontes
// estilizadas (ex: gerador de "fancy text") não são letras a-z normais e
// seriam todas removidas, sobrando só o ID (ex: "-1177") - o normalize()
// converte a maioria dessas variações Unicode pro equivalente ASCII antes de
// filtrar. Se mesmo assim não sobrar nenhuma letra, usa um nome de reserva.
function slugificarNomeCanal(nome, fallbackId) {
  const semAcentos = nome.normalize('NFKD').replace(/[̀-ͯ]/g, '');

  const slug = semAcentos
    .toLowerCase()
    .replace(/[^a-z0-9-|]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');

  if (!/[a-z]/.test(slug)) {
    return `membro-${fallbackId.slice(-6)}`;
  }

  return slug;
}

// Cria (ou recria) o canal privado de farm de um usuário na categoria de
// baú configurada, com o botão de Entregar Meta. Retorna o canal criado,
// ou null se a categoria não estiver configurada/for inválida.
async function criarCanalPrivadoFarm(guild, config, userId, categoriaBauId, embedParaEnviar) {
  if (!categoriaBauId) return null;

  const categoria = guild.channels.cache.get(categoriaBauId);
  if (!categoria || categoria.type !== 4) return null; // GuildCategory

  const membro = await guild.members.fetch(userId);
  const nomeFormatado = config.membros_info?.[userId]?.nomeFormatado;
  const nomeCanal = slugificarNomeCanal(nomeFormatado || membro.displayName, userId);

  const responsaveisFarmIds = config.farm?.cargo_responsaveis_farm || [];

  const permissoes = [
    { id: guild.id, deny: ['ViewChannel'] }, // @everyone
    { id: userId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
  ];
  for (const roleId of responsaveisFarmIds) {
    permissoes.push({ id: roleId, allow: ['ViewChannel', 'ReadMessageHistory'] });
  }

  const canalPessoa = await guild.channels.create({
    name: nomeCanal,
    type: 0, // GuildText
    parent: categoriaBauId,
    permissionOverwrites: permissoes,
  });

  const { ButtonBuilder, ButtonStyle } = require('discord.js');
  const botaoEntregar = new ButtonBuilder()
    .setCustomId('entregar_meta')
    .setLabel('📦 Entregar Meta')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(botaoEntregar);

  await canalPessoa.send({
    embeds: [embedParaEnviar],
    components: [row],
  });

  console.log(`✅ Canal de farm criado para ${membro.user.tag}: #${nomeCanal}`);
  return canalPessoa;
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        const payload = { content: 'Ocorreu um erro ao executar este comando.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      }
    }

    if (interaction.isModalSubmit()) {
      // Tentar dispatcher de handlers registrados primeiro
      try {
        if (await dispatchModal(interaction)) {
          return; // Handler foi executado com sucesso
        }
      } catch (error) {
        console.error('Erro no dispatcher de modal:', error);
        // Continua para fallback
      }

      // Handler para validar senha do painel_configuracao
      if (interaction.customId === 'modal_senha_painel') {
        const senhaInput = interaction.fields.getTextInputValue('senha_input');
        const guildId = interaction.guild.id;

        try {
          const senhaValida = await serverService.validarSenhaPainel(guildId, senhaInput);

          if (!senhaValida) {
            return await interaction.reply({
              content: '❌ Senha incorreta!',
              ephemeral: true,
            });
          }

          // Senha correta - mostrar painel
          const { ButtonBuilder, ButtonStyle } = require('discord.js');
          const embed = new EmbedBuilder()
            .setTitle('⚙️ Painel de Configuração')
            .setDescription('Selecione a categoria que deseja configurar:')
            .setColor(0x3498db);

          const botoes = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('cat_boas_vindas')
              .setLabel('👋 Boas-vindas')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('cat_registro')
              .setLabel('📋 Registro')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('cat_farm')
              .setLabel('🌾 Farm')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('cat_recrutamento')
              .setLabel('👥 Recrutamento')
              .setStyle(ButtonStyle.Primary)
          );

          const botoes2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('cat_status')
              .setLabel('✅ Status')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId('limpar_config_painel')
              .setLabel('🗑️ Limpar Configurações')
              .setStyle(ButtonStyle.Danger)
          );

          await interaction.reply({
            embeds: [embed],
            components: [botoes, botoes2],
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao validar senha: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      // Handler para validar senha do admin_bot
      if (interaction.customId === 'modal_senha_admin_bot') {
        const senhaInput = interaction.fields.getTextInputValue('senha_input');
        const guildId = interaction.guild.id;

        try {
          const senhaValida = await serverService.validarSenhaPainel(guildId, senhaInput);

          if (!senhaValida) {
            return await interaction.reply({
              content: '❌ Senha incorreta!',
              ephemeral: true,
            });
          }

          // Senha correta - mostrar painel admin
          const { ButtonBuilder, ButtonStyle } = require('discord.js');
          const embed = new EmbedBuilder()
            .setTitle('⚙️ Painel do Administrador')
            .setDescription('Selecione a categoria que deseja configurar:')
            .setColor(0x3498db);

          const botoes = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('cat_credenciais')
              .setLabel('🔧 Credenciais')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('cat_cargos')
              .setLabel('🔴 Cargos Bot')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('cat_cargos_sistema')
              .setLabel('⭐ Cargos Sistema')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('cat_cargos_farm')
              .setLabel('🌾 Cargos Farm')
              .setStyle(ButtonStyle.Primary)
          );

          const botoes2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('cat_status_admin')
              .setLabel('✅ Status')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId('limpar_config_bot_ids')
              .setLabel('🗑️ Limpar IDs')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId('limpar_config_admin_menu')
              .setLabel('🗑️ Limpar Configurações')
              .setStyle(ButtonStyle.Danger)
          );

          await interaction.reply({
            embeds: [embed],
            components: [botoes, botoes2],
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao validar senha: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'modal_admin_bot') {
        const token = interaction.fields.getTextInputValue('discord_token');
        const clientId = interaction.fields.getTextInputValue('client_id');
        const guildId = interaction.fields.getTextInputValue('guild_id');

        const config = await serverService.getConfig(interaction.guild.id);
        config.discord_token = token;
        config.client_id = clientId;
        config.guild_id = guildId;
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ Configurações do bot salvas com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_boas_vindas_mensagem') {
        const texto = interaction.fields.getTextInputValue('texto_boas_vindas');
        const banner = interaction.fields.getTextInputValue('banner_url');

        console.log('🔍 DEBUG Modal Boas-Vindas:');
        console.log('   Texto recebido:', texto);
        console.log('   Banner recebido (raw):', banner);
        console.log('   Banner type:', typeof banner);
        console.log('   Banner === "":', banner === '');
        console.log('   Banner length:', banner?.length);

        const config = await serverService.getConfig(interaction.guild.id);
        config.boas_vindas = {
          ...(config.boas_vindas || {}),
          texto: texto,
          banner_url: banner || undefined,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        console.log('📝 Boas-vindas configuradas:');
        console.log('   Texto:', texto);
        console.log('   Banner URL:', banner || 'nenhuma');
        console.log('   Config salva:', JSON.stringify(config.boas_vindas, null, 2));

        await interaction.reply({
          content: '✅ Mensagem e banner configurados com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_boas_vindas_saida') {
        const texto = interaction.fields.getTextInputValue('texto_saida');

        const config = await serverService.getConfig(interaction.guild.id);
        config.boas_vindas = {
          ...(config.boas_vindas || {}),
          mensagem_saida: texto || undefined,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: texto
            ? `✅ Mensagem de saída configurada!\n\n**Preview:** ${texto.replace(/\{usuario\}/g, interaction.member.displayName).replace(/\{servidor\}/g, interaction.guild.name)}`
            : '✅ Mensagem de saída removida (voltou pro padrão).',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_registro') {
        const canalSet = interaction.fields.getTextInputValue('canal_set');
        const descricao = interaction.fields.getTextInputValue('descricao_registro') || '';

        const config = await serverService.getConfig(interaction.guild.id);
        config.registro = {
          canal_id: canalSet,
          descricao: descricao,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ Configurações de registro salvas com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_notificacoes') {
        const cargoNotificacoes = interaction.fields.getTextInputValue('cargo_notificacoes');

        const config = await serverService.getConfig(interaction.guild.id);
        config.notificacoes = {
          cargo_id: cargoNotificacoes,
          ativado: true,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ Notificações configuradas com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_aprovacoes') {
        const cargoAprovacoes = interaction.fields.getTextInputValue('cargo_aprovacoes');

        const config = await serverService.getConfig(interaction.guild.id);
        config.aprovacoes = {
          cargo_id: cargoAprovacoes,
          ativado: true,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ Aprovações configuradas com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_entregar_meta') {
        const config = await serverService.getConfig(interaction.guild.id);
        const guildId = interaction.guild.id;
        const itens = config.farm?.itens || [];
        const cargoAprovadoresIds = config.farm?.cargo_pagamento || [];

        if (!cargoAprovadoresIds || cargoAprovadoresIds.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo de aprovação foi configurado.',
            ephemeral: true,
          });
        }

        // Verificar o canal de aprovações ANTES de pedir a imagem - senão a
        // entrega fica salva no banco mas nunca aparece pra ninguém aprovar,
        // e a pessoa recebe mensagem de sucesso mesmo assim (bug silencioso)
        const canalAprovacaoIdInicial = config.farm?.canal_aprovacoes_id;
        const canalAprovacaoInicial = canalAprovacaoIdInicial
          ? interaction.guild.channels.cache.get(canalAprovacaoIdInicial)
          : null;

        if (!canalAprovacaoInicial) {
          return await interaction.reply({
            content: '❌ Canal de aprovações de farm não foi configurado (ou não foi encontrado). Contate um administrador antes de entregar sua meta.',
            ephemeral: true,
          });
        }

        // Coletar quantidades entregues do modal
        const itensEntregues = {};
        for (const item of itens) {
          const quantidade = interaction.fields.getTextInputValue(`item_${item.id}`);
          if (quantidade) {
            itensEntregues[item.id] = {
              nome: item.nome,
              quantidade: parseInt(quantidade),
            };
          }
        }

        if (Object.keys(itensEntregues).length === 0) {
          return await interaction.reply({
            content: '❌ Você precisa informar a quantidade de pelo menos um item.',
            ephemeral: true,
          });
        }

        // Verificar teto semanal por item (protege o caixa da facção contra
        // entregas muito grandes de um único material na mesma semana)
        const limiteSemanal = config.farm?.limite_semanal_item || 2000;
        const jaEntregueSemana = await deliveryService.getQuantidadeEntregueSemanaAtual(guildId, interaction.user.id);

        const itensAcimaDoLimite = [];
        for (const dados of Object.values(itensEntregues)) {
          const jaEntregue = jaEntregueSemana[dados.nome] || 0;
          if (jaEntregue + dados.quantidade > limiteSemanal) {
            const restante = Math.max(limiteSemanal - jaEntregue, 0);
            itensAcimaDoLimite.push(
              `- **${dados.nome}:** já entregou ${jaEntregue}/${limiteSemanal} essa semana. Pode entregar no máximo mais **${restante}** (tentou ${dados.quantidade}).`
            );
          }
        }

        if (itensAcimaDoLimite.length > 0) {
          return await interaction.reply({
            content: `❌ Limite semanal de **${limiteSemanal}** unidades por item excedido:\n\n${itensAcimaDoLimite.join('\n')}`,
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: '📸 Agora envie **uma imagem** aqui no canal com o print de comprovação (você tem 5 minutos). Formatos aceitos: PNG, JPG, JPEG, GIF, WEBP.',
          ephemeral: true,
        });

        marcarAguardandoImagem(interaction.channel.id);
        try {
          const coletadas = await interaction.channel.awaitMessages({
            filter: (msg) =>
              msg.author.id === interaction.user.id &&
              [...msg.attachments.values()].some((att) => att.contentType?.startsWith('image/')),
            max: 1,
            time: 5 * 60 * 1000,
            errors: ['time'],
          });

          const mensagemComImagem = coletadas.first();
          const imagem = [...mensagemComImagem.attachments.values()].find((att) => att.contentType?.startsWith('image/'));
          const printUrl = imagem.url;

          // Garantir que existe um registro de membro no banco (pessoas com
          // cargo atribuído manualmente, sem passar pelo fluxo de registro,
          // não têm essa linha e a entrega falharia com "Membro não encontrado")
          const membroExistente = await memberService.getMember(guildId, interaction.user.id);
          if (!membroExistente) {
            const nomeFormatadoAtual = config.membros_info?.[interaction.user.id]?.nomeFormatado;
            let nomeInGameFallback = interaction.member.displayName;
            let idFallback = null; // id_ingame é INT no banco - não pode ser texto tipo "N/A"

            if (nomeFormatadoAtual?.includes(' | ')) {
              const [nome, id] = nomeFormatadoAtual.split(' | ');
              nomeInGameFallback = nome;
              const idNum = parseInt(id, 10);
              idFallback = Number.isNaN(idNum) ? null : idNum;
            }

            await memberService.saveMember(guildId, interaction.user.id, nomeInGameFallback, idFallback, nomeFormatadoAtual || interaction.member.displayName);
            await memberService.approveMember(guildId, interaction.user.id);
          }

          // Coletar dados da entrega
          const entrega = {
            usuario_id: interaction.user.id,
            usuario_tag: interaction.user.tag,
            data_entrega: new Date().toISOString(),
            itens: itensEntregues,
            print_url: printUrl,
            status: 'pendente_aprovacao',
          };

          // Salvar entrega no banco PostgreSQL
          const entrega_id = await deliveryService.createDelivery(
            guildId,
            interaction.user.id,
            entrega.itens,
            entrega.print_url
          );
          entrega.id = entrega_id;

          // Também salvar no config para compatibilidade (será removido depois).
          // Usa append atômico no banco em vez de reescrever a config inteira,
          // pra não perder entregas de outras pessoas enviadas ao mesmo tempo.
          await serverService.appendEntregaFarm(interaction.guild.id, entrega);

          // Notificar aprovadores (canal já foi validado no início, mas
          // reconfere - pode ter sido deletado durante os 5 min de espera da imagem)
          const canalAprovacaoId = config.farm?.canal_aprovacoes_id;
          const canalAprovacao = canalAprovacaoId
            ? interaction.guild.channels.cache.get(canalAprovacaoId)
            : null;

          if (!canalAprovacao) {
            throw new Error('Canal de aprovações não encontrado (pode ter sido deletado durante o processo). Sua entrega foi salva - contate um administrador pra aprovar manualmente.');
          }

          const botaoAprovar = new (require('discord.js')).ButtonBuilder()
            .setCustomId(`aprovar_farm_${entrega_id}`)
            .setLabel('✅ Aprovar')
            .setStyle((require('discord.js')).ButtonStyle.Success);

          const botaoRecusar = new (require('discord.js')).ButtonBuilder()
            .setCustomId(`recusar_farm_${entrega_id}`)
            .setLabel('❌ Recusar')
            .setStyle((require('discord.js')).ButtonStyle.Danger);

          const row = new ActionRowBuilder().addComponents(botaoAprovar, botaoRecusar);

          const embed = new EmbedBuilder()
            .setTitle(`📦 Nova Entrega de Farm — #${entrega_id}`)
            .setColor(0x3498db)
            .addFields(
              { name: '👤 Usuário', value: interaction.member.displayName, inline: true },
              { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true }
            );

          // Adicionar items, com valor estimado pros que forem elegíveis a pagamento
          const pagamentosConfig = config.farm?.pagamentos || {};
          let descricaoItens = '';
          let valorTotalEstimado = 0;
          let temItemPagavel = false;

          for (const [itemId, dados] of Object.entries(entrega.itens)) {
            const pagamento = pagamentosConfig[itemId];
            if (pagamento?.valor_unidade) {
              const subtotal = dados.quantidade * pagamento.valor_unidade;
              valorTotalEstimado += subtotal;
              temItemPagavel = true;
              descricaoItens += `- **${dados.nome}:** ${dados.quantidade} x ${formatarMoeda(pagamento.valor_unidade)} = ${formatarMoeda(subtotal)}\n`;
            } else {
              descricaoItens += `- **${dados.nome}:** ${dados.quantidade}\n`;
            }
          }
          if (descricaoItens) {
            embed.addFields({ name: '📊 Items', value: descricaoItens });
          }
          if (temItemPagavel) {
            embed.addFields({ name: '💰 Valor Estimado', value: formatarMoeda(valorTotalEstimado), inline: false });
          }

          embed.setImage(printUrl);

          await canalAprovacao.send({
            embeds: [embed],
            components: [row],
          });

          // Deixar um registro completo no próprio canal da pessoa (sem isso
          // só sobrava a foto solta, difícil de achar o histórico depois)
          try {
            const embedHistorico = EmbedBuilder.from(embed.toJSON())
              .setTitle(`📦 Entrega #${entrega_id} — ⏳ Pendente de Aprovação`)
              .setColor(0xf1c40f);

            const mensagemHistorico = await interaction.channel.send({ embeds: [embedHistorico] });
            await serverService.patchEntregaFarm(interaction.guild.id, entrega_id, {
              historico_canal_id: interaction.channel.id,
              historico_mensagem_id: mensagemHistorico.id,
            });
          } catch (err) {
            console.warn('Não foi possível registrar histórico no canal da pessoa:', err.message);
          }

          await interaction.followUp({
            content: '✅ Entrega registrada! Aguardando aprovação dos responsáveis.',
            ephemeral: true,
          });
        } catch (err) {
          if (err instanceof Map) {
            await interaction.followUp({
              content: '❌ Tempo esgotado! Nenhuma imagem foi recebida. Clique em **Entregar Meta** novamente.',
              ephemeral: true,
            });
            return;
          }

          console.error(err);
          await interaction.followUp({
            content: `❌ Erro ao registrar entrega: ${err.message}`,
            ephemeral: true,
          });
        } finally {
          desmarcarAguardandoImagem(interaction.channel.id);
        }
      }

      if (interaction.customId.startsWith('modal_registrar_adv_')) {
        const tipoAdv = parseInt(interaction.customId.replace('modal_registrar_adv_', ''), 10);
        const config = await serverService.getConfig(interaction.guild.id);
        const nomeMembroTexto = interaction.fields.getTextInputValue('nome_membro');
        const motivoAdv = interaction.fields.getTextInputValue('motivo_adv');

        try {
          const membroId = extrairIdMembro(nomeMembroTexto);
          if (!membroId) {
            return await interaction.reply({
              content: '❌ Não consegui identificar o membro. Use **@** pra marcar (deixa o Discord autocompletar) ou cole o ID da pessoa.',
              ephemeral: true,
            });
          }

          const membroAlvo = await interaction.guild.members.fetch(membroId).catch(() => null);
          if (!membroAlvo) {
            return await interaction.reply({
              content: '❌ Membro não encontrado no servidor.',
              ephemeral: true,
            });
          }

          const canalAprovacaoAdvId = config.farm?.canal_aprovacao_adv;
          if (!canalAprovacaoAdvId) {
            return await interaction.reply({
              content: '❌ Canal de aprovação de ADV não foi configurado!',
              ephemeral: true,
            });
          }

          const canalAprovacao = interaction.guild.channels.cache.get(canalAprovacaoAdvId);
          if (!canalAprovacao) {
            return await interaction.reply({
              content: '❌ Canal de aprovação de ADV não encontrado!',
              ephemeral: true,
            });
          }

          // Criar embed para aprovação
          const advId = Date.now().toString();
          const embed = new EmbedBuilder()
            .setTitle(`⚠️ Nova Solicitação de ADV ${tipoAdv}`)
            .setColor(0xFF6B6B)
            .addFields(
              { name: '👤 Registrado por', value: interaction.user.tag, inline: true },
              { name: '⏰ Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
              { name: '🎯 Membro', value: `<@${membroAlvo.id}>`, inline: true },
              { name: '⚠️ Tipo ADV', value: `ADV ${tipoAdv}`, inline: true },
              { name: '📝 Motivo', value: motivoAdv, inline: false }
            );

          const botaoAprovar = new (require('discord.js')).ButtonBuilder()
            .setCustomId(`aprovar_adv_${advId}`)
            .setLabel('✅ Aprovar')
            .setStyle((require('discord.js')).ButtonStyle.Success);

          const botaoRejeitar = new (require('discord.js')).ButtonBuilder()
            .setCustomId(`rejeitar_adv_${advId}`)
            .setLabel('❌ Rejeitar')
            .setStyle((require('discord.js')).ButtonStyle.Danger);

          const row = new ActionRowBuilder().addComponents(botaoAprovar, botaoRejeitar);

          // Salvar info de ADV pendente
          if (!config.farm.advs_pendentes) config.farm.advs_pendentes = {};
          config.farm.advs_pendentes[advId] = {
            membroId: membroAlvo.id,
            tipoAdv,
            motivo: motivoAdv,
            registradoPor: interaction.user.id,
            registradoPorTag: interaction.user.tag,
            data: new Date().toISOString(),
          };
          await serverService.saveConfig(interaction.guild.id, config);

          await canalAprovacao.send({
            embeds: [embed],
            components: [row],
          });

          await interaction.reply({
            content: `✅ ADV registrado para <@${membroAlvo.id}>! Aguardando aprovação dos responsáveis.`,
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao registrar ADV: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('modal_remover_adv_')) {
        const tipoAdv = parseInt(interaction.customId.replace('modal_remover_adv_', ''), 10);
        const config = await serverService.getConfig(interaction.guild.id);
        const nomeMembroTexto = interaction.fields.getTextInputValue('nome_membro_remover');

        try {
          const membroId = extrairIdMembro(nomeMembroTexto);
          if (!membroId) {
            return await interaction.reply({
              content: '❌ Não consegui identificar o membro. Use **@** pra marcar (deixa o Discord autocompletar) ou cole o ID da pessoa.',
              ephemeral: true,
            });
          }

          const membroAlvo = await interaction.guild.members.fetch(membroId).catch(() => null);
          if (!membroAlvo) {
            return await interaction.reply({
              content: '❌ Membro não encontrado no servidor.',
              ephemeral: true,
            });
          }

          const canalAprovacaoAdvId = config.farm?.canal_aprovacao_adv;
          if (!canalAprovacaoAdvId) {
            return await interaction.reply({
              content: '❌ Canal de aprovação de ADV não foi configurado!',
              ephemeral: true,
            });
          }

          const canalAprovacao = interaction.guild.channels.cache.get(canalAprovacaoAdvId);
          if (!canalAprovacao) {
            return await interaction.reply({
              content: '❌ Canal de aprovação de ADV não encontrado!',
              ephemeral: true,
            });
          }

          // Criar embed para aprovação de remoção
          const advId = Date.now().toString();
          const embed = new EmbedBuilder()
            .setTitle(`✅ Solicitação de Remoção de ADV ${tipoAdv}`)
            .setColor(0x2ecc71)
            .addFields(
              { name: '👤 Solicitado por', value: interaction.user.tag, inline: true },
              { name: '⏰ Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
              { name: '🎯 Membro', value: `<@${membroAlvo.id}>`, inline: true },
              { name: '⚠️ ADV a Remover', value: `ADV ${tipoAdv}`, inline: true }
            );

          const botaoAprovar = new (require('discord.js')).ButtonBuilder()
            .setCustomId(`confirmar_remover_adv_${advId}`)
            .setLabel('✅ Confirmar Remoção')
            .setStyle((require('discord.js')).ButtonStyle.Success);

          const botaoRejeitar = new (require('discord.js')).ButtonBuilder()
            .setCustomId(`cancelar_remover_adv_${advId}`)
            .setLabel('❌ Cancelar')
            .setStyle((require('discord.js')).ButtonStyle.Danger);

          const row = new ActionRowBuilder().addComponents(botaoAprovar, botaoRejeitar);

          // Salvar info de remoção pendente
          if (!config.farm.remocoes_adv_pendentes) config.farm.remocoes_adv_pendentes = {};
          config.farm.remocoes_adv_pendentes[advId] = {
            membroId: membroAlvo.id,
            tipoAdv,
            solicitadoPor: interaction.user.id,
            solicitadoPorTag: interaction.user.tag,
            data: new Date().toISOString(),
          };
          await serverService.saveConfig(interaction.guild.id, config);

          await canalAprovacao.send({
            embeds: [embed],
            components: [row],
          });

          await interaction.reply({
            content: `✅ Solicitação de remoção enviada para <@${membroAlvo.id}>! Aguardando aprovação dos responsáveis.`,
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao solicitar remoção de ADV: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'modal_cadastro_item') {
        const nomesInput = interaction.fields.getTextInputValue('nome_item');
        const descricaoItem = interaction.fields.getTextInputValue('descricao_item') || '';

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};
        if (!config.farm.itens) config.farm.itens = [];

        // Dividir por vírgula e criar cada item
        const nomes = nomesInput
          .split(',')
          .map(nome => nome.trim())
          .filter(nome => nome.length > 0);

        if (nomes.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum nome de item válido fornecido.',
            ephemeral: true,
          });
        }

        let itensAdicionados = [];

        for (const nome of nomes) {
          const novoItem = {
            id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            nome: nome,
            descricao: descricaoItem,
            data_criacao: new Date().toISOString(),
          };

          config.farm.itens.push(novoItem);
          itensAdicionados.push(nome);
        }

        await serverService.saveConfig(interaction.guild.id, config);

        const mensagem = nomes.length === 1
          ? `✅ Item **${nomes[0]}** cadastrado com sucesso!`
          : `✅ **${nomes.length} items** cadastrados com sucesso:\n${nomes.map(n => `- ${n}`).join('\n')}`;

        await interaction.reply({
          content: `${mensagem}\n\nAgora configure as metas e valores para estes items.`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_cadastro_meta') {
        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};
        if (!config.farm.metas) config.farm.metas = {};

        const itens = config.farm.itens || [];
        let metasAdicionadas = [];

        // Processar cada item
        for (const item of itens) {
          const quantidadeStr = interaction.fields.getTextInputValue(`meta_${item.id}`);

          if (quantidadeStr && quantidadeStr.trim()) {
            const quantidade = parseInt(quantidadeStr);
            if (!isNaN(quantidade) && quantidade > 0) {
              config.farm.metas[item.id] = {
                nome: item.nome,
                meta_semanal: quantidade,
                data_atualizacao: new Date().toISOString(),
              };
              metasAdicionadas.push(`${item.nome}: ${quantidade}/semana`);
            }
          }
        }

        await serverService.saveConfig(interaction.guild.id, config);

        if (metasAdicionadas.length === 0) {
          return await interaction.reply({
            content: '⚠️ Nenhuma meta foi definida (campos vazios).',
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: `✅ **${metasAdicionadas.length}** meta(s) definida(s):\n${metasAdicionadas.map(m => `- ${m}`).join('\n')}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_cadastro_pagamento') {
        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};
        if (!config.farm.pagamentos) config.farm.pagamentos = {};

        const itens = config.farm.itens || [];
        let pagamentosAdicionados = [];
        let itensRemovidos = [];

        // Processar apenas os items que foram exibidos no modal (máximo 5)
        for (let i = 0; i < Math.min(itens.length, 5); i++) {
          const item = itens[i];
          const valorStr = interaction.fields.getTextInputValue(`valor_${item.id}`);

          if (valorStr && valorStr.trim()) {
            const valor = parseFloat(valorStr.replace(',', '.'));
            if (!isNaN(valor) && valor > 0) {
              config.farm.pagamentos[item.id] = {
                nome: item.nome,
                valor_unidade: valor,
                data_atualizacao: new Date().toISOString(),
              };
              pagamentosAdicionados.push(`${item.nome}: ${formatarMoeda(valor)}/unidade`);
            }
          } else if (config.farm.pagamentos[item.id]) {
            // Campo deixado em branco: item deixa de ser elegível a pagamento
            delete config.farm.pagamentos[item.id];
            itensRemovidos.push(item.nome);
          }
        }

        await serverService.saveConfig(interaction.guild.id, config);

        if (pagamentosAdicionados.length === 0 && itensRemovidos.length === 0) {
          return await interaction.reply({
            content: '⚠️ Nenhum valor foi definido (campos vazios).',
            ephemeral: true,
          });
        }

        let resposta = '';
        if (pagamentosAdicionados.length > 0) {
          resposta += `✅ **${pagamentosAdicionados.length}** item(s) elegível(is) a pagamento:\n${pagamentosAdicionados.map(p => `- ${p}`).join('\n')}`;
        }
        if (itensRemovidos.length > 0) {
          resposta += `${resposta ? '\n\n' : ''}🚫 **${itensRemovidos.length}** item(s) removido(s) da elegibilidade:\n${itensRemovidos.map(n => `- ${n}`).join('\n')}`;
        }

        await interaction.reply({
          content: resposta,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_limite_semanal_farm') {
        const limiteStr = interaction.fields.getTextInputValue('limite_semanal');
        const limite = parseInt(limiteStr, 10);

        if (isNaN(limite) || limite <= 0) {
          return await interaction.reply({
            content: '❌ Informe um número válido maior que zero.',
            ephemeral: true,
          });
        }

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};
        config.farm.limite_semanal_item = limite;
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: `✅ Limite semanal configurado! Cada pessoa pode entregar no máximo **${limite}** unidades de cada item por semana.`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_atualizar_registro_membro_generico') {
        const nomeInGame = interaction.fields.getTextInputValue('nome_in_game');
        const id = interaction.fields.getTextInputValue('id_registro');
        const atualizarCargo = interaction.fields.getTextInputValue('atualizar_cargo').toLowerCase();
        const solicitadoPor = interaction.fields.getTextInputValue('solicitado_por');
        const userId = interaction.user.id;

        const config = await serverService.getConfig(interaction.guild.id);

        // Salvar dados temporários da atualização
        if (!config.atualizacoes_pendentes) config.atualizacoes_pendentes = {};
        config.atualizacoes_pendentes[userId] = {
          nomeInGame,
          id,
          solicitadoPor,
          data: new Date().toISOString(),
          atualizarCargo: atualizarCargo === 'sim',
        };
        await serverService.saveConfig(interaction.guild.id, config);

        // Se não vai atualizar cargo, enviar direto para aprovação
        if (atualizarCargo !== 'sim') {
          const canalAprovacaoId = config.boas_vindas?.canal_aprovacoes_id;
          const canalAprovacao = canalAprovacaoId
            ? interaction.guild.channels.cache.get(canalAprovacaoId)
            : null;

          if (canalAprovacao) {
            const botaoAprovar = new (require('discord.js')).ButtonBuilder()
              .setCustomId(`aprovar_atualizacao_${userId}`)
              .setLabel('✅ Aprovar')
              .setStyle((require('discord.js')).ButtonStyle.Success);

            const botaoRecusar = new (require('discord.js')).ButtonBuilder()
              .setCustomId(`recusar_atualizacao_${userId}`)
              .setLabel('❌ Recusar')
              .setStyle((require('discord.js')).ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(botaoAprovar, botaoRecusar);

            const embed = new EmbedBuilder()
              .setTitle('📝 Atualização de Registro (Sem Cargo)')
              .setColor(0x3498db)
              .addFields(
                { name: '👤 Usuário', value: interaction.user.tag, inline: true },
                { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
                { name: 'Nome In-Game', value: nomeInGame, inline: true },
                { name: 'ID', value: id, inline: true },
                { name: 'Solicitado por', value: solicitadoPor, inline: false }
              )
              .setFooter({ text: `ID do Discord: ${userId}` })
              .setTimestamp();

            await canalAprovacao.send({
              embeds: [embed],
              components: [row],
            });
          }

          return await interaction.reply({
            content: '✅ Atualização enviada para aprovação!',
            ephemeral: true,
          });
        }

        // Se vai atualizar cargo, mostrar menu de cargos
        const { StringSelectMenuBuilder } = require('discord.js');
        const cargosIds = config.cargos_disponiveis || [];

        const cargos = cargosIds
          .map(id => interaction.guild.roles.cache.get(id))
          .filter(role => role)
          .map(role => ({
            label: role.name,
            value: role.id,
            description: `Cargo: ${role.name}`,
          }));

        if (cargos.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo disponível para atualização.',
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_cargo_atualizacao')
          .setPlaceholder('Selecione o novo cargo...')
          .addOptions(cargos.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**Selecione o novo cargo:**',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_atualizar_registro_membro') {
        const nomeInGame = interaction.fields.getTextInputValue('nome_in_game');
        const id = interaction.fields.getTextInputValue('id_registro');
        const atualizarCargo = interaction.fields.getTextInputValue('atualizar_cargo').toLowerCase();
        const solicitadoPor = interaction.fields.getTextInputValue('solicitado_por');

        const config = await serverService.getConfig(interaction.guild.id);

        // Salvar dados temporários da atualização
        if (!config.atualizacoes_pendentes) config.atualizacoes_pendentes = {};
        config.atualizacoes_pendentes[interaction.user.id] = {
          nomeInGame,
          id,
          solicitadoPor,
          data: new Date().toISOString(),
          atualizarCargo: atualizarCargo === 'sim',
        };
        await serverService.saveConfig(interaction.guild.id, config);

        // Se não vai atualizar cargo, enviar direto para aprovação
        if (atualizarCargo !== 'sim') {
          const canalAprovacaoId = config.boas_vindas?.canal_aprovacoes_id;
          const canalAprovacao = canalAprovacaoId
            ? interaction.guild.channels.cache.get(canalAprovacaoId)
            : null;

          if (canalAprovacao) {
            const botaoAprovar = new (require('discord.js')).ButtonBuilder()
              .setCustomId(`aprovar_atualizacao_${interaction.user.id}`)
              .setLabel('✅ Aprovar')
              .setStyle((require('discord.js')).ButtonStyle.Success);

            const botaoRecusar = new (require('discord.js')).ButtonBuilder()
              .setCustomId(`recusar_atualizacao_${interaction.user.id}`)
              .setLabel('❌ Recusar')
              .setStyle((require('discord.js')).ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(botaoAprovar, botaoRecusar);

            const embed = new EmbedBuilder()
              .setTitle('📝 Atualização de Registro (Sem Cargo)')
              .setColor(0x3498db)
              .addFields(
                { name: '👤 Usuário', value: interaction.user.tag, inline: true },
                { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
                { name: 'Nome In-Game', value: nomeInGame, inline: true },
                { name: 'ID', value: id, inline: true },
                { name: 'Solicitado por', value: solicitadoPor, inline: false }
              )
              .setFooter({ text: `ID do Discord: ${interaction.user.id}` })
              .setTimestamp();

            await canalAprovacao.send({
              embeds: [embed],
              components: [row],
            });
          }

          return await interaction.reply({
            content: '✅ Atualização enviada para aprovação!',
            ephemeral: true,
          });
        }

        // Se vai atualizar cargo, mostrar menu de cargos
        const { StringSelectMenuBuilder } = require('discord.js');
        const cargosIds = config.cargos_disponiveis || [];

        const cargos = cargosIds
          .map(id => interaction.guild.roles.cache.get(id))
          .filter(role => role)
          .map(role => ({
            label: role.name,
            value: role.id,
            description: `Cargo: ${role.name}`,
          }));

        if (cargos.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo disponível para atualização.',
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`select_cargo_atualizacao_${interaction.user.id}`)
          .setPlaceholder('Selecione o novo cargo...')
          .addOptions(cargos.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**Selecione o novo cargo:**',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_registro_membro') {
        const nomeInGame = interaction.fields.getTextInputValue('nome_in_game');
        const id = interaction.fields.getTextInputValue('id_registro');
        const telefone = interaction.fields.getTextInputValue('telefone_registro') || 'Não informado';
        const recrutador = interaction.fields.getTextInputValue('recrutador_registro') || 'Não informado';

        const config = await serverService.getConfig(interaction.guild.id);

        // Salvar dados do registro para usar na aprovação
        if (!config.registros_pendentes) config.registros_pendentes = {};
        config.registros_pendentes[interaction.user.id] = {
          nomeInGame,
          id,
          telefone,
          recrutador,
          data: new Date().toISOString(),
        };

        // Usar canal de aprovações do painel de boas-vindas
        const setChannelId = config.boas_vindas?.canal_aprovacoes_id;
        const setChannel = interaction.guild.channels.cache.get(setChannelId);

        if (!setChannel) {
          return interaction.reply({
            content: '❌ Canal de aprovações não configurado. Contate um administrador.',
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setTitle('📋 NOVO REGISTRO')
          .setColor(0x2ecc71)
          .addFields(
            { name: 'NOME IN-GAME', value: nomeInGame, inline: true },
            { name: 'ID', value: id, inline: true },
            { name: 'TELEFONE', value: telefone, inline: false },
            { name: 'RECRUTADOR(A)', value: recrutador, inline: false },
            { name: '🔗 Discord', value: `<@${interaction.user.id}>`, inline: false }
          )
          .setFooter({ text: `ID do Discord: ${interaction.user.id}` })
          .setTimestamp();

        const botoes = new ActionRowBuilder().addComponents(
          new (require('discord.js')).ButtonBuilder()
            .setCustomId(`aprovar_registro_${interaction.user.id}`)
            .setLabel('✅ Aprovar')
            .setStyle((require('discord.js')).ButtonStyle.Success),
          new (require('discord.js')).ButtonBuilder()
            .setCustomId(`rejeitar_registro_${interaction.user.id}`)
            .setLabel('❌ Rejeitar')
            .setStyle((require('discord.js')).ButtonStyle.Danger)
        );

        await serverService.saveConfig(interaction.guild.id, config);

        try {
          await setChannel.send({ embeds: [embed], components: [botoes] });
        } catch (err) {
          console.error('Erro ao enviar registro no canal:', err.message);
          return await interaction.reply({
            content: `❌ Erro ao registrar (canal sem permissão): ${err.message}. Contate um administrador.`,
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: '✅ Registro recebido! Aguarde a análise da administração.',
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith('modal_atualizar_registro_hierarquia_')) {
        const tierAlvo = interaction.customId.replace('modal_atualizar_registro_hierarquia_', '');
        const nomeInGame = interaction.fields.getTextInputValue('nome_in_game');
        const id = interaction.fields.getTextInputValue('id_registro');
        const solicitadoPor = interaction.fields.getTextInputValue('solicitado_por');
        const userId = interaction.user.id;

        const config = await serverService.getConfig(interaction.guild.id);

        if (!config.atualizacoes_hierarquia_pendentes) config.atualizacoes_hierarquia_pendentes = {};
        config.atualizacoes_hierarquia_pendentes[userId] = {
          nomeInGame,
          id,
          solicitadoPor,
          tierAlvo,
          data: new Date().toISOString(),
        };
        await serverService.saveConfig(interaction.guild.id, config);

        const canalAprovacaoId = config.boas_vindas?.canal_aprovacoes_id;
        const canalAprovacao = canalAprovacaoId
          ? interaction.guild.channels.cache.get(canalAprovacaoId)
          : null;

        if (!canalAprovacao) {
          return await interaction.reply({
            content: '❌ Canal de aprovações não configurado. Contate um administrador.',
            ephemeral: true,
          });
        }

        const nomesTier = { manter: 'Nome/ID (sem mudar cargo)', membro: 'Membro', gerente: 'Gerente', lideranca: 'Liderança' };
        const tituloEmbed = tierAlvo === 'manter'
          ? '📋 SOLICITAÇÃO DE ATUALIZAÇÃO DE DADOS'
          : `📋 SOLICITAÇÃO DE PROMOÇÃO — ${nomesTier[tierAlvo] || tierAlvo}`;

        const embed = new EmbedBuilder()
          .setTitle(tituloEmbed)
          .setColor(0xf39c12)
          .addFields(
            { name: '🔗 Discord', value: `<@${userId}>`, inline: false },
            { name: 'NOME IN-GAME', value: nomeInGame, inline: true },
            { name: 'ID', value: id, inline: true },
            { name: 'SOLICITADO POR', value: solicitadoPor, inline: false }
          )
          .setFooter({ text: `ID do Discord: ${userId}` })
          .setTimestamp();

        const botoes = new ActionRowBuilder().addComponents(
          new (require('discord.js')).ButtonBuilder()
            .setCustomId(`aprovar_promocao_${userId}`)
            .setLabel('✅ Aprovar')
            .setStyle((require('discord.js')).ButtonStyle.Success),
          new (require('discord.js')).ButtonBuilder()
            .setCustomId(`recusar_promocao_${userId}`)
            .setLabel('❌ Recusar')
            .setStyle((require('discord.js')).ButtonStyle.Danger)
        );

        try {
          await canalAprovacao.send({ embeds: [embed], components: [botoes] });
        } catch (err) {
          console.error('Erro ao enviar atualização de registro no canal:', err.message);
          return await interaction.reply({
            content: `❌ Erro ao enviar solicitação (canal sem permissão): ${err.message}. Contate um administrador.`,
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: tierAlvo === 'manter'
            ? '✅ Solicitação de atualização de dados enviada! Aguarde a análise da administração.'
            : '✅ Solicitação de promoção enviada! Aguarde a análise da administração.',
          ephemeral: true,
        });
      }
    }

    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'select_membro_limpar_farm') {
        const membroId = interaction.values[0];

        try {
          const totalEntregas = await deliveryService.contarEntregasPorMembro(interaction.guild.id, membroId);

          if (totalEntregas === 0) {
            return await interaction.reply({
              content: `❌ <@${membroId}> não tem nenhuma entrega de farm registrada.`,
              ephemeral: true,
            });
          }

          const { ButtonBuilder, ButtonStyle } = require('discord.js');
          const botaoConfirmar = new ButtonBuilder()
            .setCustomId(`confirmar_limpar_farm_membro_${membroId}`)
            .setLabel('✅ Sim, apagar tudo')
            .setStyle(ButtonStyle.Danger);

          const botaoCancelar = new ButtonBuilder()
            .setCustomId('cancelar_limpar_farm_membro')
            .setLabel('❌ Não, manter')
            .setStyle(ButtonStyle.Secondary);

          const row = new ActionRowBuilder().addComponents(botaoConfirmar, botaoCancelar);

          await interaction.reply({
            content: `⚠️ **ATENÇÃO!**\n\n<@${membroId}> tem **${totalEntregas}** entrega(s) de farm registrada(s) (aprovadas, pendentes e recusadas).\n\nIsso vai **apagar permanentemente** todo o histórico de entregas dessa pessoa (inclusive pagamentos já registrados) e zerar o limite semanal dela.\n\n**Tem certeza que deseja continuar?**`,
            components: [row],
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao buscar entregas do membro: ${err.message}`,
            ephemeral: true,
          });
        }
      }
    }

    if (interaction.isButton()) {
      // Tentar dispatcher de handlers registrados (O(1) complexity com Map)
      try {
        if (await dispatchButton(interaction)) {
          return; // Handler foi executado com sucesso
        }
      } catch (error) {
        console.error('Erro no dispatcher de button:', error);
        // Continua para fallback
      }

      // Mapeamento rápido de handlers para evitar iteração sequencial de 4600 linhas
      // Dispatch prioritário para categorias principais
      if (interaction.customId.startsWith('cat_')) {
        const handleCategoryButton = async (customId) => {
          const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

          switch (customId) {
            case 'cat_boas_vindas': {
              const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('painel_boas_vindas')
                .setPlaceholder('Escolha uma opção...')
                .addOptions({
                  label: 'Configurar',
                  description: 'Configurar sistema de boas-vindas',
                  value: 'config_boas_vindas',
                });
              const row = new ActionRowBuilder().addComponents(selectMenu);
              await interaction.reply({
                content: '**👋 Boas-vindas**\n\nSelecione a opção:',
                components: [row],
                ephemeral: true,
              });
              return true;
            }
            case 'cat_status': {
              try {
                const config = await serverService.getConfig(interaction.guild.id);
                const truncate = (str, max = 1024) => {
                  if (!str) return '❌';
                  return str.length > max ? str.substring(0, max - 3) + '...' : str;
                };

                const boasVindasCanal = config.boas_vindas?.canal_id
                  ? `✅ #${interaction.guild.channels.cache.get(config.boas_vindas.canal_id)?.name || 'ID Inválido'}`
                  : '❌';
                const boasVindasRegistro = config.boas_vindas?.canal_registro_id
                  ? `✅ #${interaction.guild.channels.cache.get(config.boas_vindas.canal_registro_id)?.name || 'ID Inválido'}`
                  : '❌';
                const boasVindasAprovacoes = config.boas_vindas?.canal_aprovacoes_id
                  ? `✅ #${interaction.guild.channels.cache.get(config.boas_vindas.canal_aprovacoes_id)?.name || 'ID Inválido'}`
                  : '❌';

                const registro = config.registro?.canal_id
                  ? `✅ #${interaction.guild.channels.cache.get(config.registro.canal_id)?.name || 'ID Inválido'}`
                  : '❌';

                const farmCategoria = config.farm?.categoria_bau_id
                  ? `✅ ${interaction.guild.channels.cache.get(config.farm.categoria_bau_id)?.name || 'ID Inválido'}`
                  : '❌';

                const farmCanal = config.farm?.canal_aprovacoes_id
                  ? `✅ ${interaction.guild.channels.cache.get(config.farm.canal_aprovacoes_id)?.name || 'ID Inválido'}`
                  : '❌';

                const boasVindas = config.boas_vindas ? '✅ Configurado' : '❌ Não configurado';
                const farmStatus = config.farm ? '✅ Configurado' : '❌ Não configurado';

                const statusEmbed = new EmbedBuilder()
                  .setTitle('✅ Status da Configuração')
                  .setColor(0x2ecc71)
                  .addFields(
                    { name: '**Boas-vindas**', value: boasVindas, inline: false },
                    { name: 'Canal', value: boasVindasCanal, inline: true },
                    { name: 'Registro', value: boasVindasRegistro, inline: true },
                    { name: 'Aprovações', value: boasVindasAprovacoes, inline: true },
                    { name: '**Registro**', value: truncate(JSON.stringify(config.registro || {})), inline: false },
                    { name: 'Canal', value: registro, inline: true },
                    { name: '**Farm**', value: farmStatus, inline: false },
                    { name: 'Categoria', value: farmCategoria, inline: true },
                    { name: 'Aprovações', value: farmCanal, inline: true }
                  );

                await interaction.reply({
                  embeds: [statusEmbed],
                  ephemeral: true,
                });
                return true;
              } catch (err) {
                console.error('Erro em cat_status:', err);
                await interaction.reply({
                  content: `❌ Erro ao exibir status: ${err.message}`,
                  ephemeral: true,
                });
                return true;
              }
            }
            case 'cat_registro': {
              const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('painel_registro')
                .setPlaceholder('Escolha uma opção...')
                .addOptions(
                  {
                    label: 'Canal de Registro',
                    description: 'Onde aparecem os botões de Pedir/Atualizar Registro',
                    value: 'config_reg_canal_registro',
                  },
                  {
                    label: 'Canal de Aprovações',
                    description: 'Onde aparecem registros para aprovar/rejeitar',
                    value: 'config_reg_canal_aprovacoes',
                  },
                  {
                    label: 'Cargos que Podem Aprovar',
                    description: 'Quem pode aprovar/rejeitar registros e promoções',
                    value: 'config_aprovacoes',
                  }
                );
              const row = new ActionRowBuilder().addComponents(selectMenu);
              await interaction.reply({
                content: '**📋 Registro**\n\nSelecione a opção:',
                components: [row],
                ephemeral: true,
              });
              return true;
            }
          }
          return false; // Não foi um dos principais, cair nos if abaixo
        };

        if (await handleCategoryButton(interaction.customId)) {
          return; // Handler foi encontrado e executado
        }
      }

      if (interaction.customId === 'cat_credenciais') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('painel_credenciais')
          .setPlaceholder('Escolha uma opção...')
          .addOptions(
            {
              label: 'Configurar',
              description: 'Configurar token, client ID e guild ID',
              value: 'cred_configurar',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**🔧 Credenciais**\n\nSelecione a opção:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_cargos') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('painel_cargos')
          .setPlaceholder('Escolha uma opção...')
          .addOptions(
            {
              label: 'Gerenciar Cargos',
              description: 'Selecionar cargos que o bot vai usar',
              value: 'cargos_gerenciar',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**🔴 Cargos**\n\nSelecione a opção:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_recrutamento') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('painel_recrutamento')
          .setPlaceholder('Escolha uma opção...')
          .addOptions(
            {
              label: 'Canal de Uniforme',
              description: 'Configurar canal com o uniforme da fac',
              value: 'rec_canal_uniforme',
            },
            {
              label: 'Canal de Regras da Fac',
              description: 'Configurar canal com as regras da fac',
              value: 'rec_canal_regras_fac',
            },
            {
              label: 'Canal de Regras da Cidade',
              description: 'Configurar canal com as regras da cidade',
              value: 'rec_canal_regras_cidade',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**👥 Recrutamento**\n\nSelecione a opção:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_farm') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('painel_farm')
          .setPlaceholder('Escolha uma opção...')
          .addOptions(
            {
              label: 'Canal de Abrir Baú',
              description: 'Onde fica o botão para abrir baú',
              value: 'farm_canal_bau',
            },
            {
              label: 'Banner do Baú',
              description: 'Definir GIF/imagem do botão de Abrir Baú',
              value: 'farm_banner_bau',
            },
            {
              label: 'Categoria de Farm',
              description: 'Configurar categoria para canais de baú',
              value: 'farm_categoria',
            },
            {
              label: 'Criar Itens',
              description: 'Adicionar itens ao farm',
              value: 'farm_criar_itens',
            },
            {
              label: 'Criar Metas',
              description: 'Definir metas de farm',
              value: 'farm_criar_metas',
            },
            {
              label: 'Criar Pagamento',
              description: 'Definir valor pago por unidade de cada item',
              value: 'farm_criar_pagamento',
            },
            {
              label: 'Canal de Aprovações',
              description: 'Configurar canal onde aparecem as entregas',
              value: 'farm_canal_aprovacoes',
            },
            {
              label: 'Canal de Controle de Pagamento',
              description: 'Canal onde gerentes controlam pagamentos aprovados',
              value: 'farm_canal_pagamento',
            },
            {
              label: 'Marcar Sem Baú Aberto em Massa',
              description: 'Aplica o cargo a quem é Morador+ e não abriu o baú',
              value: 'farm_marcar_sem_bau',
            },
            {
              label: 'Limite Semanal por Item',
              description: 'Máximo que cada pessoa pode entregar de um item por semana',
              value: 'farm_limite_semanal',
            },
            {
              label: 'Canal de Gerenciamento',
              description: 'Canal onde o painel de estatísticas é publicado',
              value: 'farm_canal_gerenciamento',
            },
            {
              label: 'Limpar Farm de um Membro',
              description: 'Apaga todas as entregas de uma pessoa (ex: dados de teste)',
              value: 'farm_limpar_membro',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**🌾 Farm**\n\nSelecione a opção:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_advs') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('painel_advs')
          .setPlaceholder('Escolha uma opção...')
          .addOptions(
            {
              label: 'Canal de Registro de ADV',
              description: 'Onde fica o botão para registrar/remover ADV',
              value: 'adv_canal_registro',
            },
            {
              label: 'Canal de Aprovação de ADV',
              description: 'Onde aparecem os ADVs para aprovação',
              value: 'adv_canal_aprovacao',
            },
            {
              label: 'Cargos que Podem Dar ADV',
              description: 'Quem pode registrar ADVs',
              value: 'adv_cargos_registro',
            },
            {
              label: 'Cargos que Podem Aprovar ADV',
              description: 'Quem aprova os ADVs registrados',
              value: 'adv_cargos_aprovacao',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**⚠️ Sistema de ADVs**\n\nSelecione a opção:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_cargos_farm') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('painel_cargos_farm')
          .setPlaceholder('Escolha uma opção...')
          .addOptions(
            {
              label: 'Materiais',
              description: 'Cargos que cadastram itens de farm',
              value: 'cargo_materiais',
            },
            {
              label: 'Metas',
              description: 'Cargos que cadastram metas de farm',
              value: 'cargo_metas',
            },
            {
              label: 'Pagamento (Aprovadores)',
              description: 'Cargos que aprovam entregas de farm',
              value: 'cargo_pagamento',
            },
            {
              label: 'Farm em Dia',
              description: 'Cargo atribuído quando entrega é aprovada',
              value: 'cargo_em_dia',
            },
            {
              label: 'Farm Atrasado',
              description: 'Cargo atribuído quando não entrega',
              value: 'cargo_atrasado',
            },
            {
              label: 'ADV Farm 1',
              description: '1ª advertência de farm atrasado',
              value: 'cargo_adv_1',
            },
            {
              label: 'ADV Farm 2',
              description: '2ª advertência (máximo antes de PD)',
              value: 'cargo_adv_2',
            },
            {
              label: 'Responsáveis por Farm',
              description: 'Cargos notificados quando atinge 2 ADVs',
              value: 'cargo_responsaveis_farm',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**🌾 Cargos de Farm**\n\nSelecione qual cargo você quer configurar:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_cargos_sistema') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('painel_cargos_sistema')
          .setPlaceholder('Escolha uma opção...')
          .addOptions(
            {
              label: 'Cargo Morador',
              description: 'Cargo dado ao abrir o baú',
              value: 'cargo_morador',
            },
            {
              label: 'Cargo Membro',
              description: 'Cargo da hierarquia acima de Morador',
              value: 'cargo_membro',
            },
            {
              label: 'Cargo Gerente',
              description: 'Cargo acima de Membro',
              value: 'cargo_gerente',
            },
            {
              label: 'Cargo Liderança',
              description: 'Cargo máximo da hierarquia (acima de Gerente)',
              value: 'cargo_lideranca',
            },
            {
              label: 'Cargo Baú Aberto',
              description: 'Cargo dado junto ao Morador',
              value: 'cargo_bau_aberto',
            },
            {
              label: 'Cargo Sem Baú Aberto',
              description: 'Marca quem ainda não abriu o baú',
              value: 'cargo_bau_nao_aberto',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**⭐ Cargos do Sistema**\n\nSelecione o cargo que deseja configurar:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_status_admin') {
        try {
          const config = await serverService.getConfig(interaction.guild.id);

          const safeValue = (value) => {
          if (!value || !value.trim()) return '❌ Não configurado';
          // Limitar a 1024 caracteres (limite do Discord.js)
          return value.length > 1024 ? value.substring(0, 1021) + '...' : value;
        };

          // Credenciais
          const token = config.discord_token ? '✅ Configurado' : '❌ Não configurado';
        const clientId = config.client_id ? '✅ Configurado' : '❌ Não configurado';
        const guildId = config.guild_id ? '✅ Configurado' : '❌ Não configurado';

        // Cargos de Registro
        const cargoMorador = config.cargo_morador_id
          ? `✅ ${interaction.guild.roles.cache.get(config.cargo_morador_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const cargoMembro = config.cargo_membro_id
          ? `✅ ${interaction.guild.roles.cache.get(config.cargo_membro_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const cargoGerente = config.cargo_gerente_ids?.length > 0
          ? `✅ ${config.cargo_gerente_ids.map(id => interaction.guild.roles.cache.get(id)?.name || 'ID Inválido').join(', ')}`
          : '❌ Não configurado';

        const cargoLideranca = config.cargo_lideranca_ids?.length > 0
          ? `✅ ${config.cargo_lideranca_ids.map(id => interaction.guild.roles.cache.get(id)?.name || 'ID Inválido').join(', ')}`
          : '❌ Não configurado';


        // Cargos Farm
        const farmEmDia = config.farm?.cargo_em_dia_id
          ? `✅ ${interaction.guild.roles.cache.get(config.farm.cargo_em_dia_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const farmAtrasado = config.farm?.cargo_atrasado_id
          ? `✅ ${interaction.guild.roles.cache.get(config.farm.cargo_atrasado_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const advFarm1 = config.farm?.cargo_adv_1
          ? `✅ ${interaction.guild.roles.cache.get(config.farm.cargo_adv_1)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const advFarm2 = config.farm?.cargo_adv_2
          ? `✅ ${interaction.guild.roles.cache.get(config.farm.cargo_adv_2)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        // Canais Farm
        const canalBau = config.farm?.canal_bau_id
          ? `✅ #${interaction.guild.channels.cache.get(config.farm.canal_bau_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const canalAprovacoesFarm = config.farm?.canal_aprovacoes_id
          ? `✅ #${interaction.guild.channels.cache.get(config.farm.canal_aprovacoes_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        // Canais ADV
        const canalRegistroAdv = config.farm?.canal_registro_adv
          ? `✅ #${interaction.guild.channels.cache.get(config.farm.canal_registro_adv)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const canalAprovacaoAdv = config.farm?.canal_aprovacao_adv
          ? `✅ #${interaction.guild.channels.cache.get(config.farm.canal_aprovacao_adv)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        // Cargos Permissões Farm
        const cargosPagamentoNomes = config.farm?.cargo_pagamento?.length > 0
          ? config.farm.cargo_pagamento.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ')
          : '';
        const cargosPagamento = safeValue(cargosPagamentoNomes);

        const cargosResponsaveisNomes = config.farm?.cargo_responsaveis_farm?.length > 0
          ? config.farm.cargo_responsaveis_farm.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ')
          : '';
        const cargosResponsaveis = safeValue(cargosResponsaveisNomes);

        // Cargos Permissões ADV
        const cargosRegistroAdvNomes = config.farm?.cargo_registro_adv?.length > 0
          ? config.farm.cargo_registro_adv.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ')
          : '';
        const cargosRegistroAdv = safeValue(cargosRegistroAdvNomes);

        const cargosAprovacaoAdvNomes = config.farm?.cargo_aprovacao_adv?.length > 0
          ? config.farm.cargo_aprovacao_adv.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ')
          : '';
        const cargosAprovacaoAdv = safeValue(cargosAprovacaoAdvNomes);

        const truncate = (str, max = 1024) => {
          if (!str) return '❌';
          return str.length > max ? str.substring(0, max - 3) + '...' : str;
        };

        const embed = new EmbedBuilder()
          .setTitle('✅ Status Completo do Bot')
          .setColor(0x2ecc71)
          .addFields(
          { name: '🔐 Discord Token', value: truncate(token), inline: true },
          { name: '🆔 Client ID', value: truncate(clientId), inline: true },
          { name: '🏢 Guild ID', value: truncate(guildId), inline: true },

          { name: '👥 Morador', value: truncate(cargoMorador), inline: true },
          { name: '👤 Membro', value: truncate(cargoMembro), inline: true },
          { name: '👨‍💼 Gerente', value: truncate(cargoGerente), inline: true },
          { name: '🎖️ Liderança', value: truncate(cargoLideranca), inline: true },

          { name: '✅ Farm em Dia', value: truncate(farmEmDia), inline: true },
          { name: '⏸️ Farm Atrasado', value: truncate(farmAtrasado), inline: true },
          { name: '⚠️ ADV 1', value: truncate(advFarm1), inline: true },
          { name: '🚨 ADV 2', value: truncate(advFarm2), inline: true },

          { name: '📦 Abrir Baú', value: truncate(canalBau), inline: true },
          { name: '📢 Farm Aprovações', value: truncate(canalAprovacoesFarm), inline: true },

          { name: '⚠️ Registro ADV', value: truncate(canalRegistroAdv), inline: true },
          { name: '✔️ Aprovação ADV', value: truncate(canalAprovacaoAdv), inline: true },

          { name: '💰 Podem Pagar', value: truncate(cargosPagamento), inline: false },
          { name: '👨‍🌾 Responsáveis', value: truncate(cargosResponsaveis), inline: false },
          { name: '⚠️ Podem Dar ADV', value: truncate(cargosRegistroAdv), inline: false },
          { name: '✅ Aprovam ADV', value: truncate(cargosAprovacaoAdv), inline: false }
        );

        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
        } catch (error) {
          console.error('❌ Erro em cat_status_admin:', error);
          await interaction.reply({
            content: `❌ Erro ao exibir status: ${error.message}`,
            ephemeral: true,
          }).catch(err => console.error('Erro ao enviar mensagem de erro:', err));
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      // NOTA: Dispatcher para selectMenus desabilitado pois há muitas variações complexas
      // Apenas os select_canal_* que salvam config estão no dispatcher
      // Tudo o mais usa o código legado que funciona bem

      if (interaction.customId === 'select_tipo_adv_registrar') {
        const tipoAdv = interaction.values[0];

        const modal = new ModalBuilder()
          .setCustomId(`modal_registrar_adv_${tipoAdv}`)
          .setTitle(`⚠️ Registrar ADV ${tipoAdv}`);

        const nomeInput = new TextInputBuilder()
          .setCustomId('nome_membro')
          .setLabel('Nome ou Menção do Membro')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Use @ pra marcar (autocomplete) ou cole o ID')
          .setRequired(true);

        const motivoInput = new TextInputBuilder()
          .setCustomId('motivo_adv')
          .setLabel('Motivo do ADV')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Digite o motivo da advertência')
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nomeInput),
          new ActionRowBuilder().addComponents(motivoInput)
        );

        await interaction.showModal(modal);
      }

      if (interaction.customId === 'select_tipo_adv_remover') {
        const tipoAdv = interaction.values[0];

        const modal = new ModalBuilder()
          .setCustomId(`modal_remover_adv_${tipoAdv}`)
          .setTitle(`✅ Remover ADV ${tipoAdv}`);

        const nomeInput = new TextInputBuilder()
          .setCustomId('nome_membro_remover')
          .setLabel('Nome ou Menção do Membro')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Use @ pra marcar (autocomplete) ou cole o ID')
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nomeInput));

        await interaction.showModal(modal);
      }

      if (interaction.customId === 'select_tipo_atualizacao_registro') {
        const tierAlvo = interaction.values[0];
        const nomesTier = { manter: 'Nome/ID', membro: 'Membro', gerente: 'Gerente', lideranca: 'Liderança' };

        const modal = new ModalBuilder()
          .setCustomId(`modal_atualizar_registro_hierarquia_${tierAlvo}`)
          .setTitle(`📋 Atualizar ${nomesTier[tierAlvo] || tierAlvo}`);

        const nomeInput = new TextInputBuilder()
          .setCustomId('nome_in_game')
          .setLabel('Seu nome in-game (novo)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: Levi')
          .setRequired(true);

        const idInput = new TextInputBuilder()
          .setCustomId('id_registro')
          .setLabel('Seu ID na cidade (novo)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 1202')
          .setRequired(true);

        const solicitadoInput = new TextInputBuilder()
          .setCustomId('solicitado_por')
          .setLabel('Quem solicitou esta atualização?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Nome de quem pediu')
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nomeInput),
          new ActionRowBuilder().addComponents(idInput),
          new ActionRowBuilder().addComponents(solicitadoInput)
        );

        await interaction.showModal(modal);
      }

      if (interaction.customId === 'painel_credenciais') {
        const valor = interaction.values[0];

        if (valor === 'cred_configurar') {
          const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

          const modal = new ModalBuilder()
            .setCustomId('modal_admin_bot')
            .setTitle('🔧 Configurações do Bot');

          const tokenInput = new TextInputBuilder()
            .setCustomId('discord_token')
            .setLabel('Discord Token do Bot')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Cola o token aqui')
            .setRequired(true);

          const clientIdInput = new TextInputBuilder()
            .setCustomId('client_id')
            .setLabel('Client ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Cola o Client ID aqui')
            .setRequired(true);

          const guildIdInput = new TextInputBuilder()
            .setCustomId('guild_id')
            .setLabel('Guild ID (ID do Servidor)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Cola o ID do servidor aqui')
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder().addComponents(tokenInput),
            new ActionRowBuilder().addComponents(clientIdInput),
            new ActionRowBuilder().addComponents(guildIdInput)
          );

          await interaction.showModal(modal);
        }
      }

      if (interaction.customId === 'painel_advs') {
        const valor = interaction.values[0];
        const { StringSelectMenuBuilder } = require('discord.js');
        const config = await serverService.getConfig(interaction.guild.id);

        if (valor === 'adv_canal_registro' || valor === 'adv_canal_aprovacao') {
          // Mostrar categorias de canais
          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === 4) // 4 = GUILD_CATEGORY
            .map(ch => ({
              label: ch.name,
              value: `cat_${ch.id}`,
              description: `${ch.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada no servidor.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_cat_${valor}`)
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias.slice(0, 25));

          const row = new ActionRowBuilder().addComponents(selectMenu);
          const titulo = valor === 'adv_canal_registro' ? 'Canal de Registro de ADV' : 'Canal de Aprovação de ADV';

          await interaction.reply({
            content: `**${titulo}**\n\nPrimeiro, selecione a categoria:`,
            components: [row],
            ephemeral: true,
          });
        } else {
          // Seletor de cargos (para registro e aprovação)
          const cargos = interaction.guild.roles.cache
            .filter(role => !role.managed && role.id !== interaction.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(role => ({
              label: role.name,
              value: role.id,
              description: `Posição: ${role.position}`,
            }));

          if (cargos.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum cargo encontrado no servidor.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_${valor}`)
            .setPlaceholder('Selecione os cargos...')
            .setMinValues(1)
            .setMaxValues(Math.min(cargos.length, 25))
            .addOptions(cargos.slice(0, 25));

          const row = new ActionRowBuilder().addComponents(selectMenu);

          const titulos = {
            adv_cargos_registro: 'Cargos que Podem Dar ADV',
            adv_cargos_aprovacao: 'Cargos que Podem Aprovar ADV',
          };

          await interaction.reply({
            content: `**${titulos[valor]}**\n\nSelecione quais cargo(s) podem ${valor === 'adv_cargos_registro' ? 'registrar' : 'aprovar'} ADVs:`,
            components: [row],
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'painel_cargos_farm') {
        const valor = interaction.values[0];
        const { StringSelectMenuBuilder } = require('discord.js');

        const cargos = interaction.guild.roles.cache
          .filter(role => !role.managed && role.id !== interaction.guild.id)
          .sort((a, b) => b.position - a.position)
          .map(role => ({
            label: role.name,
            value: role.id,
            description: `Posição: ${role.position}`,
          }));

        if (cargos.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo encontrado no servidor.',
            ephemeral: true,
          });
        }

        const titulos = {
          cargo_materiais: 'Materiais',
          cargo_metas: 'Metas',
          cargo_pagamento: 'Pagamento (Aprovadores)',
          cargo_em_dia: 'Farm em Dia',
          cargo_atrasado: 'Farm Atrasado',
          cargo_adv_1: 'ADV Farm 1',
          cargo_adv_2: 'ADV Farm 2',
          cargo_responsaveis_farm: 'Responsáveis por Farm',
        };

        // Determinar se é múltiplo ou único
        const ehMultiplo = ['cargo_materiais', 'cargo_metas', 'cargo_pagamento', 'cargo_responsaveis_farm'].includes(valor);

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`select_${valor}`)
          .setPlaceholder(ehMultiplo ? 'Selecione os cargos...' : 'Selecione o cargo...')
          .setMinValues(1)
          .setMaxValues(ehMultiplo ? Math.min(cargos.length, 25) : 1)
          .addOptions(cargos.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: `**${titulos[valor]}**\n\nSelecione qual(is) cargo(s) deseja configurar:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'painel_cargos_sistema') {
        const valor = interaction.values[0];
        const { StringSelectMenuBuilder } = require('discord.js');

        const cargos = interaction.guild.roles.cache
          .filter(role => !role.managed && role.id !== interaction.guild.id)
          .sort((a, b) => b.position - a.position)
          .map(role => ({
            label: role.name,
            value: role.id,
            description: `Posição: ${role.position}`,
          }));

        if (cargos.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo encontrado no servidor.',
            ephemeral: true,
          });
        }

        const customIdsPorValor = {
          cargo_morador: 'select_cargo_morador',
          cargo_membro: 'select_cargo_membro',
          cargo_gerente: 'select_cargo_gerente',
          cargo_lideranca: 'select_cargo_lideranca',
          cargo_bau_aberto: 'select_cargo_bau_aberto',
          cargo_bau_nao_aberto: 'select_cargo_bau_nao_aberto',
        };
        const titulosPorValor = {
          cargo_morador: 'Cargo Morador',
          cargo_membro: 'Cargo Membro',
          cargo_gerente: 'Cargo Gerente',
          cargo_lideranca: 'Cargo Liderança',
          cargo_bau_aberto: 'Cargo Baú Aberto',
          cargo_bau_nao_aberto: 'Cargo Sem Baú Aberto',
        };

        // Gerente e Liderança aceitam vários cargos (ex: múltiplos cargos de gerência)
        const ehMultiplo = valor === 'cargo_gerente' || valor === 'cargo_lideranca';

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(customIdsPorValor[valor])
          .setPlaceholder(ehMultiplo ? 'Selecione os cargos...' : 'Selecione o cargo...')
          .setMinValues(1)
          .setMaxValues(ehMultiplo ? Math.min(cargos.length, 25) : 1)
          .addOptions(cargos.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: `**${titulosPorValor[valor]}**\n\nSelecione qual(is) cargo(s) será(ão) atribuído(s):`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'painel_cargos') {
        const valor = interaction.values[0];

        if (valor === 'cargos_gerenciar') {
          const { StringSelectMenuBuilder } = require('discord.js');

          const cargos = interaction.guild.roles.cache
            .filter(role => !role.managed && role.id !== interaction.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(role => ({
              label: role.name,
              value: role.id,
              description: `Posição: ${role.position}`,
            }));

          if (cargos.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum cargo encontrado no servidor.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_cargos_bot')
            .setPlaceholder('Selecione os cargos que o bot vai usar...')
            .setMinValues(1)
            .setMaxValues(Math.min(cargos.length, 25))
            .addOptions(cargos.slice(0, 25));

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**🔴 Gerenciar Cargos**\n\nSelecione quais cargos o bot vai usar (você pode escolher vários):',
            components: [row],
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'select_cargo_materiais' ||
          interaction.customId === 'select_cargo_metas' ||
          interaction.customId === 'select_cargo_pagamento') {

        const cargoIds = interaction.values; // Agora pega todos!
        const tipo = interaction.customId.replace('select_', '');

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};

        config.farm[tipo] = cargoIds;
        await serverService.saveConfig(interaction.guild.id, config);

        const cargosNomes = cargoIds
          .map(id => interaction.guild.roles.cache.get(id).name)
          .join(', ');

        const titulos = {
          cargo_materiais: 'Materiais',
          cargo_metas: 'Metas',
          cargo_pagamento: 'Pagamento',
        };

        await interaction.reply({
          content: `✅ ${titulos[tipo]} configurado!\n**Cargos:** ${cargosNomes}`,
          ephemeral: true,
        });
      }

      // Handler para cargos únicos de farm
      if (interaction.customId === 'select_cargo_em_dia' ||
          interaction.customId === 'select_cargo_atrasado' ||
          interaction.customId === 'select_cargo_adv_1' ||
          interaction.customId === 'select_cargo_adv_2' ||
          interaction.customId === 'select_cargo_responsaveis_farm') {

        const tipo = interaction.customId.replace('select_', '');
        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};

        const titulosCargo = {
          cargo_em_dia: 'Farm em Dia',
          cargo_atrasado: 'Farm Atrasado',
          cargo_adv_1: 'ADV Farm 1',
          cargo_adv_2: 'ADV Farm 2',
          cargo_responsaveis_farm: 'Responsáveis por Farm',
        };

        if (interaction.customId === 'select_cargo_responsaveis_farm') {
          // Responsáveis pode ser múltiplo
          const cargoIds = interaction.values;
          config.farm[tipo] = cargoIds;
          const cargosNomes = cargoIds.map(id => interaction.guild.roles.cache.get(id).name).join(', ');
          await serverService.saveConfig(interaction.guild.id, config);

          await interaction.reply({
            content: `✅ ${titulosCargo[tipo]} configurado!\n**Cargos:** ${cargosNomes}`,
            ephemeral: true,
          });
        } else {
          // Cargos de dia/atrasado/adv são únicos
          const cargoId = interaction.values[0];
          config.farm[`${tipo}_id`] = cargoId;
          await serverService.saveConfig(interaction.guild.id, config);

          const cargo = interaction.guild.roles.cache.get(cargoId);

          await interaction.reply({
            content: `✅ ${titulosCargo[tipo]} configurado!\n**Cargo:** ${cargo.name}`,
            ephemeral: true,
          });
        }
      }

      // Handlers para seleção de categoria de ADV
      if (interaction.customId === 'select_cat_adv_canal_registro' || interaction.customId === 'select_cat_adv_canal_aprovacao') {
        const { StringSelectMenuBuilder } = require('discord.js');
        const categoriaId = interaction.values[0].replace('cat_', '');
        const tipoCanal = interaction.customId === 'select_cat_adv_canal_registro' ? 'adv_canal_registro' : 'adv_canal_aprovacao';

        const categoria = interaction.guild.channels.cache.get(categoriaId);
        if (!categoria) {
          return await interaction.reply({
            content: '❌ Categoria não encontrada.',
            ephemeral: true,
          });
        }

        // Mostrar canais da categoria
        const canaisOpcoes = categoria.children.cache
          .filter(ch => ch.type === 0) // 0 = GUILD_TEXT
          .map(ch => ({
            label: ch.name,
            value: ch.id,
            description: `Canal de texto`,
          }));

        if (canaisOpcoes.length === 0) {
          return await interaction.reply({
            content: `❌ Nenhum canal de texto encontrado em #${categoria.name}.`,
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`select_${tipoCanal}`)
          .setPlaceholder('Selecione o canal...')
          .addOptions(canaisOpcoes.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const titulo = tipoCanal === 'adv_canal_registro' ? 'Canal de Registro de ADV' : 'Canal de Aprovação de ADV';

        await interaction.reply({
          content: `**${titulo}**\n**Categoria:** #${categoria.name}\n\nAgora selecione o canal:`,
          components: [row],
          ephemeral: true,
        });
      }

      // Handlers para configuração de ADV - Canais
      if (interaction.customId === 'select_adv_canal_registro' || interaction.customId === 'select_adv_canal_aprovacao') {
        const canalId = interaction.values[0];
        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};

        const tipo = interaction.customId === 'select_adv_canal_registro' ? 'canal_registro_adv' : 'canal_aprovacao_adv';
        config.farm[tipo] = canalId;
        await serverService.saveConfig(interaction.guild.id, config);

        const canal = interaction.guild.channels.cache.get(canalId);
        const titulo = tipo === 'canal_registro_adv' ? 'Canal de Registro de ADV' : 'Canal de Aprovação de ADV';

        await interaction.reply({
          content: `✅ ${titulo} configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      // Handlers para configuração de ADV - Cargos
      if (interaction.customId === 'select_adv_cargos_registro' || interaction.customId === 'select_adv_cargos_aprovacao') {
        const cargoIds = interaction.values;
        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};

        const tipo = interaction.customId === 'select_adv_cargos_registro' ? 'cargo_registro_adv' : 'cargo_aprovacao_adv';
        config.farm[tipo] = cargoIds;
        await serverService.saveConfig(interaction.guild.id, config);

        const cargosNomes = cargoIds.map(id => interaction.guild.roles.cache.get(id).name).join(', ');
        const titulo = tipo === 'cargo_registro_adv' ? 'Cargos que Podem Dar ADV' : 'Cargos que Podem Aprovar ADV';

        await interaction.reply({
          content: `✅ ${titulo} configurado!\n**Cargos:** ${cargosNomes}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_cargo_gerente' ||
          interaction.customId === 'select_cargo_lideranca') {
        const cargoIds = interaction.values;
        const campo = interaction.customId === 'select_cargo_gerente' ? 'cargo_gerente_ids' : 'cargo_lideranca_ids';
        const titulo = interaction.customId === 'select_cargo_gerente' ? 'Gerente' : 'Liderança';

        const config = await serverService.getConfig(interaction.guild.id);
        config[campo] = cargoIds;
        await serverService.saveConfig(interaction.guild.id, config);

        const cargosNomes = cargoIds
          .map(id => interaction.guild.roles.cache.get(id)?.name || 'ID Inválido')
          .join(', ');

        await interaction.reply({
          content: `✅ Cargo(s) ${titulo} configurado(s)!\n**Cargos:** ${cargosNomes}`,
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith('select_grantrole_promocao_')) {
        const userId = interaction.customId.replace('select_grantrole_promocao_', '');
        const cargoEscolhidoId = interaction.values[0];

        const config = await serverService.getConfig(interaction.guild.id);
        const solicitacao = config.atualizacoes_hierarquia_pendentes?.[userId];

        if (!solicitacao) {
          return await interaction.reply({
            content: '❌ Solicitação não encontrada (pode já ter sido processada).',
            ephemeral: true,
          });
        }

        try {
          const canalId = solicitacao.canal_id;
          const mensagemId = solicitacao.mensagem_id;

          await concederPromocaoHierarquia(config, interaction.guild, userId, solicitacao, cargoEscolhidoId, interaction.user.id);
          await serverService.saveConfig(interaction.guild.id, config);

          await interaction.reply({
            content: `✅ Promoção de <@${userId}> aprovada!`,
            ephemeral: true,
          });

          // Limpar os botões da mensagem original de aprovação
          if (canalId && mensagemId) {
            try {
              const canalOriginal = interaction.guild.channels.cache.get(canalId);
              const mensagemOriginal = await canalOriginal?.messages.fetch(mensagemId);
              await mensagemOriginal?.edit({ components: [] });
            } catch (err) {
              console.warn('Não foi possível atualizar mensagem original:', err.message);
            }
          }
        } catch (err) {
          console.error('Erro ao conceder promoção:', err);
          await interaction.reply({
            content: `❌ Erro ao aprovar: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'select_cargo_morador' ||
          interaction.customId === 'select_cargo_membro' ||
          interaction.customId === 'select_cargo_bau_aberto' ||
          interaction.customId === 'select_cargo_bau_nao_aberto') {
        const cargoId = interaction.values[0];

        const camposPorCustomId = {
          select_cargo_morador: { campo: 'cargo_morador_id', titulo: 'Morador' },
          select_cargo_membro: { campo: 'cargo_membro_id', titulo: 'Membro' },
          select_cargo_bau_aberto: { campo: 'cargo_bau_aberto_id', titulo: 'Baú Aberto' },
          select_cargo_bau_nao_aberto: { campo: 'cargo_bau_nao_aberto_id', titulo: 'Sem Baú Aberto' },
        };
        const { campo, titulo } = camposPorCustomId[interaction.customId];

        const config = await serverService.getConfig(interaction.guild.id);
        config[campo] = cargoId;
        await serverService.saveConfig(interaction.guild.id, config);

        const cargo = interaction.guild.roles.cache.get(cargoId);

        await interaction.reply({
          content: `✅ Cargo ${titulo} configurado!\n**Cargo:** ${cargo.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_cargos_bot') {
        const cargoIds = interaction.values;

        const config = await serverService.getConfig(interaction.guild.id);
        config.cargos_disponiveis = cargoIds;
        await serverService.saveConfig(interaction.guild.id, config);

        const cargosNomes = cargoIds
          .map(id => interaction.guild.roles.cache.get(id).name)
          .join(', ');

        await interaction.reply({
          content: `✅ Cargos do bot configurados!\n**Cargos selecionados:** ${cargosNomes}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_cargo_notificacoes') {
        const cargoIds = interaction.values;

        const config = await serverService.getConfig(interaction.guild.id);
        config.notificacoes = {
          cargo_ids: cargoIds,
          ativado: true,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        const cargosNomes = cargoIds
          .map(id => interaction.guild.roles.cache.get(id).name)
          .join(', ');

        await interaction.reply({
          content: `✅ Notificações configuradas!\n**Cargos notificados:** ${cargosNomes}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_cargo_aprovacoes') {
        const cargoIds = interaction.values;

        const config = await serverService.getConfig(interaction.guild.id);
        config.aprovacoes = {
          cargo_ids: cargoIds,
          ativado: true,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        const cargosNomes = cargoIds
          .map(id => interaction.guild.roles.cache.get(id).name)
          .join(', ');

        await interaction.reply({
          content: `✅ Aprovações configuradas!\n**Cargos aprovadores:** ${cargosNomes}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_categoria_registro') {
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');
        const categoriaId = interaction.values[0];

        const categoria = interaction.guild.channels.cache.get(categoriaId);
        const canaisTexto = categoria.children.cache
          .filter(ch => ch.type === ChannelType.GuildText)
          .map(ch => ({
            label: ch.name,
            value: ch.id,
            description: `#${ch.name}`,
          }));

        if (canaisTexto.length === 0) {
          return await interaction.reply({
            content: `❌ Nenhum canal de texto encontrado em **${categoria.name}**.`,
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_canal_registro')
          .setPlaceholder('Selecione o canal...')
          .addOptions(canaisTexto);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: `**📋 Canal de Registro**\n\n**Passo 2:** Selecione o canal em **${categoria.name}**:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_canal_registro') {
        const canalId = interaction.values[0];

        const config = await serverService.getConfig(interaction.guild.id);
        config.registro = {
          ...(config.registro || {}),
          canal_id: canalId,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de registro configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      // Selecionar categoria de aprovações
      if (interaction.customId === 'select_categoria_aprovacoes') {
        try {
          const categoriaId = interaction.values[0];
          const { ChannelType, StringSelectMenuBuilder } = require('discord.js');

          const categoria = interaction.guild.channels.cache.get(categoriaId);
          if (!categoria) {
            return await interaction.reply({
              content: '❌ Categoria não encontrada.',
              ephemeral: true,
            });
          }

          const canais = categoria.children.cache
            .filter(ch => ch.type === ChannelType.GuildText)
            .map(canal => ({
              label: `#${canal.name}`,
              value: canal.id,
              description: canal.topic || 'Sem descrição',
            }));

          if (canais.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum canal de texto encontrado nesta categoria.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_canal_aprovacoes')
            .setPlaceholder('Selecione o canal...')
            .addOptions(canais.slice(0, 25));

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: `**Passo 2:** Canal de Aprovações\n\nSelecione o canal em **${categoria.name}**:`,
            components: [row],
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em select_categoria_aprovacoes:', err);
          await interaction.reply({
            content: '❌ Erro ao selecionar categoria',
            ephemeral: true,
          });
        }
      }

      // Selecionar canal de aprovações
      if (interaction.customId === 'select_canal_aprovacoes') {
        try {
          const canalId = interaction.values[0];

          const config = await serverService.getConfig(interaction.guild.id);
          if (!config.farm) config.farm = {};
          config.farm.canal_aprovacoes_id = canalId;
          await serverService.saveConfig(interaction.guild.id, config);

          const canal = interaction.guild.channels.cache.get(canalId);

          await interaction.reply({
            content: `✅ Canal de aprovações configurado!\n**Canal:** #${canal.name}\n\nAs entregas de farm aparecerão aqui.`,
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em select_canal_aprovacoes:', err);
          await interaction.reply({
            content: '❌ Erro ao configurar canal de aprovações',
            ephemeral: true,
          });
        }
      }

      // Selecionar categoria do canal de controle de pagamento
      if (interaction.customId === 'select_categoria_canal_pagamento') {
        try {
          const categoriaId = interaction.values[0];
          const { ChannelType, StringSelectMenuBuilder } = require('discord.js');

          const categoria = interaction.guild.channels.cache.get(categoriaId);
          if (!categoria) {
            return await interaction.reply({
              content: '❌ Categoria não encontrada.',
              ephemeral: true,
            });
          }

          const canais = categoria.children.cache
            .filter(ch => ch.type === ChannelType.GuildText)
            .map(canal => ({
              label: `#${canal.name}`,
              value: canal.id,
              description: canal.topic || 'Sem descrição',
            }));

          if (canais.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum canal de texto encontrado nesta categoria.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_canal_pagamento')
            .setPlaceholder('Selecione o canal...')
            .addOptions(canais.slice(0, 25));

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: `**Passo 2:** Canal de Controle de Pagamento\n\nSelecione o canal em **${categoria.name}**:`,
            components: [row],
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em select_categoria_canal_pagamento:', err);
          await interaction.reply({
            content: '❌ Erro ao selecionar categoria',
            ephemeral: true,
          });
        }
      }

      // Selecionar canal de controle de pagamento
      if (interaction.customId === 'select_canal_pagamento') {
        try {
          const canalId = interaction.values[0];

          const config = await serverService.getConfig(interaction.guild.id);
          if (!config.farm) config.farm = {};
          config.farm.canal_controle_pagamento_id = canalId;
          await serverService.saveConfig(interaction.guild.id, config);

          const canal = interaction.guild.channels.cache.get(canalId);

          await interaction.reply({
            content: `✅ Canal de controle de pagamento configurado!\n**Canal:** #${canal.name}\n\nAs entregas aprovadas com valor a pagar aparecerão aqui.`,
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em select_canal_pagamento:', err);
          await interaction.reply({
            content: '❌ Erro ao configurar canal de controle de pagamento',
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'select_categoria_canal_gerenciamento') {
        try {
          const categoriaId = interaction.values[0];
          const { ChannelType, StringSelectMenuBuilder } = require('discord.js');

          const categoria = interaction.guild.channels.cache.get(categoriaId);
          if (!categoria) {
            return await interaction.reply({
              content: '❌ Categoria não encontrada.',
              ephemeral: true,
            });
          }

          const canais = categoria.children.cache
            .filter(ch => ch.type === ChannelType.GuildText)
            .map(canal => ({
              label: `#${canal.name}`,
              value: canal.id,
              description: canal.topic || 'Sem descrição',
            }));

          if (canais.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum canal de texto encontrado nesta categoria.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_canal_gerenciamento')
            .setPlaceholder('Selecione o canal...')
            .addOptions(canais.slice(0, 25));

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: `**Passo 2:** Canal de Gerenciamento\n\nSelecione o canal em **${categoria.name}**:`,
            components: [row],
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em select_categoria_canal_gerenciamento:', err);
          await interaction.reply({
            content: '❌ Erro ao selecionar categoria',
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'select_canal_gerenciamento') {
        try {
          const canalId = interaction.values[0];

          const config = await serverService.getConfig(interaction.guild.id);
          if (!config.farm) config.farm = {};
          config.farm.canal_gerenciamento_id = canalId;
          await serverService.saveConfig(interaction.guild.id, config);

          const canal = interaction.guild.channels.cache.get(canalId);

          await interaction.reply({
            content: `✅ Canal de gerenciamento configurado!\n**Canal:** #${canal.name}\n\nUse \`/publicar_ger_farm\` para publicar o painel lá.`,
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em select_canal_gerenciamento:', err);
          await interaction.reply({
            content: '❌ Erro ao configurar canal de gerenciamento',
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'painel_farm') {
        const valor = interaction.values[0];
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

        if (valor === 'farm_canal_bau') {
          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_farm_canal_bau')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**Canal de Abrir Baú**\n\n**Passo 1:** Selecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'farm_banner_bau') {
          const config = await serverService.getConfig(interaction.guild.id);
          const bannerAtual = config.farm?.banner_url || config.farm?.imagem_url || '';

          const modal = new ModalBuilder()
            .setCustomId('modal_configurar_banner_bau')
            .setTitle('📦 Banner do Baú');

          const urlInput = new TextInputBuilder()
            .setCustomId('banner_bau_url')
            .setLabel('URL do GIF/Imagem')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://imgur.com/seu-gif.gif')
            .setValue(bannerAtual)
            .setRequired(false);

          modal.addComponents(new ActionRowBuilder().addComponents(urlInput));

          await interaction.showModal(modal);
        }

        if (valor === 'farm_categoria') {
          const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada no servidor.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_bau_farm')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**📁 Categoria de Farm**\n\nSelecione em qual categoria os canais de baú serão criados:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'farm_criar_itens') {
          const config = await serverService.getConfig(interaction.guild.id);
          const cargoIds = config.farm?.cargo_materiais || [];

          if (!cargoIds || cargoIds.length === 0) {
            return await interaction.reply({
              content: '❌ Cargos de Materiais não foram configurados. Configure em `/admin_bot`',
              ephemeral: true,
            });
          }

          const temPermissao = cargoIds.some(id => interaction.member.roles.cache.has(id));

          if (!temPermissao) {
            return await interaction.reply({
              content: '❌ Você não tem permissão para cadastrar materiais.',
              ephemeral: true,
            });
          }

          const modal = new ModalBuilder()
            .setCustomId('modal_cadastro_item')
            .setTitle('📦 Cadastrar Item de Farm');

          const nomeInput = new TextInputBuilder()
            .setCustomId('nome_item')
            .setLabel('Nome do Item (separe por vírgula para vários)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Maconha, Cocaína, MDMA')
            .setRequired(true);

          const descricaoInput = new TextInputBuilder()
            .setCustomId('descricao_item')
            .setLabel('Descrição (Opcional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Ex: Ouro bruto da mina')
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(nomeInput),
            new ActionRowBuilder().addComponents(descricaoInput)
          );

          await interaction.showModal(modal);
        }

        if (valor === 'farm_criar_metas') {
          const config = await serverService.getConfig(interaction.guild.id);
          const cargoIds = config.farm?.cargo_metas || [];
          const itens = config.farm?.itens || [];
          const metasExistentes = config.farm?.metas || {};

          if (!cargoIds || cargoIds.length === 0) {
            return await interaction.reply({
              content: '❌ Cargo de Metas não foi configurado. Configure em `/admin_bot`',
              ephemeral: true,
            });
          }

          const temPermissao = cargoIds.some(id => interaction.member.roles.cache.has(id));

          if (!temPermissao) {
            return await interaction.reply({
              content: '❌ Você não tem permissão para cadastrar metas.',
              ephemeral: true,
            });
          }

          if (itens.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum item cadastrado. Cadastre items em "Criar Itens" primeiro.',
              ephemeral: true,
            });
          }

          // Verificar se existem metas configuradas
          const temMetasConfiguradas = Object.keys(metasExistentes).length > 0;

          if (temMetasConfiguradas) {
            // Listar metas atuais
            const metasAtuais = Object.entries(metasExistentes)
              .map(([id, meta]) => `- ${meta.nome}: ${meta.meta_semanal}/semana`)
              .join('\n');

            const { ButtonBuilder, ButtonStyle } = require('discord.js');
            const botaoConfirmar = new ButtonBuilder()
              .setCustomId('confirmar_sobrescrever_meta')
              .setLabel('✅ Sim, alterar')
              .setStyle(ButtonStyle.Danger);

            const botaoCancelar = new ButtonBuilder()
              .setCustomId('cancelar_meta')
              .setLabel('❌ Não, manter')
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(botaoConfirmar, botaoCancelar);

            return await interaction.reply({
              content: `⚠️ **Metas já configuradas!**\n\nConfiguração atual:\n${metasAtuais}\n\n**Deseja sobrescrever essas metas?**`,
              components: [row],
              ephemeral: true,
            });
          }

          // Se não tem metas, abre o modal direto
          const modal = new ModalBuilder()
            .setCustomId('modal_cadastro_meta')
            .setTitle('🎯 Definir Metas de Farm');

          // Adicionar campo para cada item (máximo 5)
          for (let i = 0; i < Math.min(itens.length, 5); i++) {
            const item = itens[i];
            const metaInput = new TextInputBuilder()
              .setCustomId(`meta_${item.id}`)
              .setLabel(`${item.nome} (quantidade/semana)`)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ex: 100')
              .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(metaInput));
          }

          await interaction.showModal(modal);
        }

        if (valor === 'farm_criar_pagamento') {
          const config = await serverService.getConfig(interaction.guild.id);
          const cargoIds = config.farm?.cargo_pagamento || [];
          const itens = config.farm?.itens || [];
          const pagamentosExistentes = config.farm?.pagamentos || {};

          if (!cargoIds || cargoIds.length === 0) {
            return await interaction.reply({
              content: '❌ Cargo de Pagamento não foi configurado. Configure em `/admin_bot`',
              ephemeral: true,
            });
          }

          const temPermissao = cargoIds.some(id => interaction.member.roles.cache.has(id));

          if (!temPermissao) {
            return await interaction.reply({
              content: '❌ Você não tem permissão para configurar pagamentos.',
              ephemeral: true,
            });
          }

          if (itens.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum item cadastrado. Cadastre items em "Criar Itens" primeiro.',
              ephemeral: true,
            });
          }

          // Verificar se já existem pagamentos configurados
          const temPagamentosConfigurados = Object.keys(pagamentosExistentes).length > 0;

          if (temPagamentosConfigurados) {
            const pagamentosAtuais = Object.entries(pagamentosExistentes)
              .map(([id, pag]) => `- ${pag.nome}: ${formatarMoeda(pag.valor_unidade)}/unidade`)
              .join('\n');

            const { ButtonBuilder, ButtonStyle } = require('discord.js');
            const botaoConfirmar = new ButtonBuilder()
              .setCustomId('confirmar_sobrescrever_pagamento')
              .setLabel('✅ Sim, alterar')
              .setStyle(ButtonStyle.Danger);

            const botaoCancelar = new ButtonBuilder()
              .setCustomId('cancelar_pagamento')
              .setLabel('❌ Não, manter')
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(botaoConfirmar, botaoCancelar);

            return await interaction.reply({
              content: `⚠️ **Pagamentos já configurados!**\n\nConfiguração atual:\n${pagamentosAtuais}\n\n**Deseja sobrescrever esses valores?**`,
              components: [row],
              ephemeral: true,
            });
          }

          // Se não tem pagamentos, abre o modal direto
          const modal = new ModalBuilder()
            .setCustomId('modal_cadastro_pagamento')
            .setTitle('💰 Valor por Unidade');

          // Adicionar campo para cada item (máximo 5, deixe em branco para não elegível)
          for (let i = 0; i < Math.min(itens.length, 5); i++) {
            const item = itens[i];
            const valorInput = new TextInputBuilder()
              .setCustomId(`valor_${item.id}`)
              .setLabel(`${item.nome} (R$ por unidade)`)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ex: 1.50 (deixe vazio se não for elegível)')
              .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(valorInput));
          }

          await interaction.showModal(modal);
        }

        if (valor === 'farm_canal_aprovacoes') {
          const { ChannelType, StringSelectMenuBuilder } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_aprovacoes')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**Passo 1:** Canal de Aprovações\n\nSelecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'farm_canal_pagamento') {
          const { ChannelType, StringSelectMenuBuilder } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_canal_pagamento')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**Passo 1:** Canal de Controle de Pagamento\n\nSelecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'farm_canal_gerenciamento') {
          const { ChannelType, StringSelectMenuBuilder } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_canal_gerenciamento')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**Passo 1:** Canal de Gerenciamento\n\nSelecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'farm_limpar_membro') {
          const config = await serverService.getConfig(interaction.guild.id);
          const cargoAprovadoresIds = config.farm?.cargo_pagamento || [];
          const temPermissao = cargoAprovadoresIds.length === 0 ||
            interaction.member.roles.cache.some(role => cargoAprovadoresIds.includes(role.id)) ||
            interaction.memberPermissions.has('ADMINISTRATOR');

          if (!temPermissao) {
            return await interaction.reply({
              content: '❌ Você não tem permissão para limpar farm de membros!',
              ephemeral: true,
            });
          }

          const { UserSelectMenuBuilder } = require('discord.js');
          const selectMembro = new UserSelectMenuBuilder()
            .setCustomId('select_membro_limpar_farm')
            .setPlaceholder('Selecione o membro...');

          const rowMembro = new ActionRowBuilder().addComponents(selectMembro);

          await interaction.reply({
            content: '**🗑️ Limpar Farm de um Membro**\n\nSelecione a pessoa:',
            components: [rowMembro],
            ephemeral: true,
          });
        }

        if (valor === 'farm_marcar_sem_bau') {
          const config = await serverService.getConfig(interaction.guild.id);
          const cargoBauAbertoId = config.cargo_bau_aberto_id;
          const cargoBauNaoAbertoId = config.cargo_bau_nao_aberto_id;
          const cargoMoradorId = config.cargo_morador_id;
          const cargoMembroId = config.cargo_membro_id;
          const cargoGerenteIds = config.cargo_gerente_ids || [];
          const cargoLiderancaIds = config.cargo_lideranca_ids || [];

          if (!cargoBauNaoAbertoId) {
            return await interaction.reply({
              content: '❌ Cargo "Sem Baú Aberto" não foi configurado. Configure em **Cargos do Sistema**.',
              ephemeral: true,
            });
          }

          if (!cargoBauAbertoId || (!cargoMoradorId && !cargoMembroId && cargoGerenteIds.length === 0 && cargoLiderancaIds.length === 0)) {
            return await interaction.reply({
              content: '❌ Cargos do sistema (Baú Aberto / Morador / Membro / Gerente / Liderança) não foram configurados.',
              ephemeral: true,
            });
          }

          const cargoBauNaoAberto = interaction.guild.roles.cache.get(cargoBauNaoAbertoId);
          if (!cargoBauNaoAberto) {
            return await interaction.reply({
              content: '❌ Cargo "Sem Baú Aberto" não encontrado no servidor.',
              ephemeral: true,
            });
          }

          await interaction.deferReply({ ephemeral: true });

          try {
            const membros = await interaction.guild.members.fetch();
            let marcados = 0;

            for (const membro of membros.values()) {
              const temHierarquiaMoradorOuMais =
                (cargoMoradorId && membro.roles.cache.has(cargoMoradorId)) ||
                (cargoMembroId && membro.roles.cache.has(cargoMembroId)) ||
                cargoGerenteIds.some(id => membro.roles.cache.has(id)) ||
                cargoLiderancaIds.some(id => membro.roles.cache.has(id));

              const jaTemBauAberto = membro.roles.cache.has(cargoBauAbertoId);
              const jaTemSemBau = membro.roles.cache.has(cargoBauNaoAbertoId);

              if (temHierarquiaMoradorOuMais && !jaTemBauAberto && !jaTemSemBau) {
                try {
                  await membro.roles.add(cargoBauNaoAbertoId);
                  marcados++;
                } catch (err) {
                  console.error(`Erro ao adicionar cargo Sem Baú a ${membro.user.tag}:`, err.message);
                }
              }
            }

            await interaction.editReply({
              content: `✅ **${marcados}** membro(s) marcado(s) com o cargo **${cargoBauNaoAberto.name}**!`,
            });
          } catch (err) {
            console.error('Erro ao aplicar cargo sem baú em massa:', err);
            await interaction.editReply({
              content: `❌ Erro ao processar membros: ${err.message}`,
            });
          }
        }

        if (valor === 'farm_limite_semanal') {
          const config = await serverService.getConfig(interaction.guild.id);
          const limiteAtual = config.farm?.limite_semanal_item || 2000;

          const modal = new ModalBuilder()
            .setCustomId('modal_limite_semanal_farm')
            .setTitle('🚧 Limite Semanal por Item');

          const limiteInput = new TextInputBuilder()
            .setCustomId('limite_semanal')
            .setLabel('Máximo por item, por pessoa, por semana')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 2000')
            .setValue(String(limiteAtual))
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(limiteInput));

          await interaction.showModal(modal);
        }
      }

      if (interaction.customId === 'painel_boas_vindas_sub') {
        const valor = interaction.values[0];
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

        if (valor === 'bv_canal') {
          const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_boas_vindas')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**Passo 1:** Selecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'bv_cargo') {
          const config = await serverService.getConfig(interaction.guild.id);
          const cargoIds = config.cargos_disponiveis || [];

          const cargos = cargoIds
            .map(id => interaction.guild.roles.cache.get(id))
            .filter(role => role)
            .map(role => ({
              label: role.name,
              value: role.id,
              description: `Posição: ${role.position}`,
            }));

          if (cargos.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum cargo foi pré-selecionado. Configure em /admin_bot gerenciar_cargos',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_cargo_boas_vindas')
            .setPlaceholder('Selecione os cargos visitante...')
            .setMinValues(1)
            .setMaxValues(Math.min(cargos.length, 25))
            .addOptions(cargos);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: 'Selecione quais cargos visitante serão atribuídos:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'bv_canal_saidas') {
          const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_bv_canal_saidas')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**Canal de Saídas**\n\n**Passo 1:** Selecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'bv_mensagem') {
          const modal = new ModalBuilder()
            .setCustomId('modal_boas_vindas_mensagem')
            .setTitle('👋 Configurar Mensagem');

          const textoInput = new TextInputBuilder()
            .setCustomId('texto_boas_vindas')
            .setLabel('Mensagem de Boas-vindas')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Ex: Bem vindo a Real Becks 🇺🇾')
            .setRequired(true);

          const bannerInput = new TextInputBuilder()
            .setCustomId('banner_url')
            .setLabel('URL da Banner/Logo')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://imgur.com/seu-logo.png')
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(textoInput),
            new ActionRowBuilder().addComponents(bannerInput)
          );

          await interaction.showModal(modal);
        }

        if (valor === 'bv_mensagem_saida') {
          const config = await serverService.getConfig(interaction.guild.id);
          const mensagemAtual = config.boas_vindas?.mensagem_saida || '';

          const modal = new ModalBuilder()
            .setCustomId('modal_boas_vindas_saida')
            .setTitle('👋 Mensagem de Saída');

          const textoInput = new TextInputBuilder()
            .setCustomId('texto_saida')
            .setLabel('Mensagem quando alguém sai')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Ex: {usuario} saiu da Real Becks. Até mais!')
            .setValue(mensagemAtual)
            .setRequired(false);

          modal.addComponents(new ActionRowBuilder().addComponents(textoInput));

          await interaction.showModal(modal);
        }
      }

      if (interaction.customId === 'select_categoria_farm_canal_bau') {
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');
        const categoriaId = interaction.values[0];

        const categoria = interaction.guild.channels.cache.get(categoriaId);
        const canaisTexto = categoria.children.cache
          .filter(ch => ch.type === ChannelType.GuildText)
          .map(ch => ({
            label: ch.name,
            value: ch.id,
            description: `#${ch.name}`,
          }));

        if (canaisTexto.length === 0) {
          return await interaction.reply({
            content: `❌ Nenhum canal de texto em **${categoria.name}**.`,
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_canal_farm_canal_bau')
          .setPlaceholder('Selecione o canal...')
          .addOptions(canaisTexto);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: `**Passo 2:** Selecione o canal em **${categoria.name}**:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_canal_farm_canal_bau') {
        const canalId = interaction.values[0];

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};
        config.farm.canal_bau_id = canalId;
        await serverService.saveConfig(interaction.guild.id, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de Abrir Baú configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_categoria_bau_farm') {
        const categoriaId = interaction.values[0];

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};

        config.farm.categoria_bau_id = categoriaId;
        await serverService.saveConfig(interaction.guild.id, config);

        const categoria = interaction.guild.channels.cache.get(categoriaId);

        await interaction.reply({
          content: `✅ Categoria de Farm configurada!\n**Categoria:** ${categoria.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_categoria_bau' || interaction.customId === 'select_categoria_roupas') {
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');
        const categoriaId = interaction.values[0];
        const isBau = interaction.customId === 'select_categoria_bau';

        const categoria = interaction.guild.channels.cache.get(categoriaId);
        const canaisTexto = categoria.children.cache
          .filter(ch => ch.type === ChannelType.GuildText)
          .map(ch => ({
            label: ch.name,
            value: ch.id,
            description: `#${ch.name}`,
          }));

        if (canaisTexto.length === 0) {
          return await interaction.reply({
            content: `❌ Nenhum canal de texto em **${categoria.name}**.`,
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(isBau ? 'select_canal_bau' : 'select_canal_roupas')
          .setPlaceholder('Selecione o canal...')
          .addOptions(canaisTexto);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const titulo = isBau ? 'Canal do Baú' : 'Canal de Roupas';

        await interaction.reply({
          content: `**${titulo}**\n\n**Passo 2:** Selecione o canal em **${categoria.name}**:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_canal_bau' || interaction.customId === 'select_canal_roupas') {
        const canalId = interaction.values[0];
        const isBau = interaction.customId === 'select_canal_bau';

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.farm) config.farm = {};

        if (isBau) {
          config.farm.canal_bau_id = canalId;
        } else {
          config.farm.canal_roupas_id = canalId;
        }

        await serverService.saveConfig(interaction.guild.id, config);

        const canal = interaction.guild.channels.cache.get(canalId);
        const titulo = isBau ? 'Baú' : 'Roupas';

        await interaction.reply({
          content: `✅ Canal de ${titulo.toLowerCase()} configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_categoria_boas_vindas') {
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');
        const categoriaId = interaction.values[0];

        const categoria = interaction.guild.channels.cache.get(categoriaId);
        const canaisTexto = categoria.children.cache
          .filter(ch => ch.type === ChannelType.GuildText)
          .map(ch => ({
            label: ch.name,
            value: ch.id,
            description: `#${ch.name}`,
          }));

        if (canaisTexto.length === 0) {
          return await interaction.reply({
            content: `❌ Nenhum canal de texto em **${categoria.name}**.`,
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_canal_boas_vindas')
          .setPlaceholder('Selecione o canal...')
          .addOptions(canaisTexto);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: `**Passo 2:** Selecione o canal em **${categoria.name}**:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_categoria_bv_canal_saidas') {
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');
        const categoriaId = interaction.values[0];

        const categoria = interaction.guild.channels.cache.get(categoriaId);
        const canaisTexto = categoria.children.cache
          .filter(ch => ch.type === ChannelType.GuildText)
          .map(ch => ({
            label: ch.name,
            value: ch.id,
            description: `#${ch.name}`,
          }));

        if (canaisTexto.length === 0) {
          return await interaction.reply({
            content: `❌ Nenhum canal de texto em **${categoria.name}**.`,
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_canal_bv_canal_saidas')
          .setPlaceholder('Selecione o canal...')
          .addOptions(canaisTexto);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: `**Passo 2:** Selecione o canal em **${categoria.name}**:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_canal_bv_canal_saidas') {
        const canalId = interaction.values[0];

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.boas_vindas) config.boas_vindas = {};
        config.boas_vindas.canal_saidas_id = canalId;
        await serverService.saveConfig(interaction.guild.id, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de Saídas configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_canal_boas_vindas') {
        const canalId = interaction.values[0];

        const config = await serverService.getConfig(interaction.guild.id);
        config.boas_vindas = {
          ...config.boas_vindas,
          canal_id: canalId,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de Boas-vindas configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_categoria_reg_canal_registro') {
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');
        const categoriaId = interaction.values[0];

        const categoria = interaction.guild.channels.cache.get(categoriaId);
        const canaisTexto = categoria.children.cache
          .filter(ch => ch.type === ChannelType.GuildText)
          .map(ch => ({
            label: ch.name,
            value: ch.id,
            description: `#${ch.name}`,
          }));

        if (canaisTexto.length === 0) {
          return await interaction.reply({
            content: `❌ Nenhum canal de texto em **${categoria.name}**.`,
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_canal_reg_canal_registro')
          .setPlaceholder('Selecione o canal...')
          .addOptions(canaisTexto);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: `**Passo 2:** Selecione o canal em **${categoria.name}**:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_canal_reg_canal_registro') {
        const canalId = interaction.values[0];

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.boas_vindas) config.boas_vindas = {};
        config.boas_vindas.canal_registro_id = canalId;
        await serverService.saveConfig(interaction.guild.id, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de Registro configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_categoria_reg_canal_aprovacoes') {
        const { StringSelectMenuBuilder, ChannelType } = require('discord.js');
        const categoriaId = interaction.values[0];

        const categoria = interaction.guild.channels.cache.get(categoriaId);
        const canaisTexto = categoria.children.cache
          .filter(ch => ch.type === ChannelType.GuildText)
          .map(ch => ({
            label: ch.name,
            value: ch.id,
            description: `#${ch.name}`,
          }));

        if (canaisTexto.length === 0) {
          return await interaction.reply({
            content: `❌ Nenhum canal de texto em **${categoria.name}**.`,
            ephemeral: true,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_canal_reg_canal_aprovacoes')
          .setPlaceholder('Selecione o canal...')
          .addOptions(canaisTexto);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: `**Passo 2:** Selecione o canal em **${categoria.name}**:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_canal_reg_canal_aprovacoes') {
        const canalId = interaction.values[0];

        const config = await serverService.getConfig(interaction.guild.id);
        if (!config.boas_vindas) config.boas_vindas = {};
        config.boas_vindas.canal_aprovacoes_id = canalId;
        await serverService.saveConfig(interaction.guild.id, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de Aprovações configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_cargo_atualizacao') {
        const cargoId = interaction.values[0];
        const userId = interaction.user.id;

        const config = await serverService.getConfig(interaction.guild.id);
        const atualizacao = config.atualizacoes_pendentes?.[userId];

        if (!atualizacao) {
          return await interaction.reply({
            content: '❌ Dados da atualização não encontrados.',
            ephemeral: true,
          });
        }

        // Salvar cargo selecionado
        atualizacao.novo_cargo_id = cargoId;
        await serverService.saveConfig(interaction.guild.id, config);

        // Enviar para aprovação
        const canalAprovacaoId = config.boas_vindas?.canal_aprovacoes_id;
        const canalAprovacao = canalAprovacaoId
          ? interaction.guild.channels.cache.get(canalAprovacaoId)
          : null;

        if (canalAprovacao) {
          const botaoAprovar = new (require('discord.js')).ButtonBuilder()
            .setCustomId(`aprovar_atualizacao_${userId}`)
            .setLabel('✅ Aprovar')
            .setStyle((require('discord.js')).ButtonStyle.Success);

          const botaoRecusar = new (require('discord.js')).ButtonBuilder()
            .setCustomId(`recusar_atualizacao_${userId}`)
            .setLabel('❌ Recusar')
            .setStyle((require('discord.js')).ButtonStyle.Danger);

          const row = new ActionRowBuilder().addComponents(botaoAprovar, botaoRecusar);

          const cargo = interaction.guild.roles.cache.get(cargoId);
          const embed = new EmbedBuilder()
            .setTitle('📝 Atualização de Registro (COM Cargo)')
            .setColor(0x3498db)
            .addFields(
              { name: '👤 Usuário', value: interaction.user.tag, inline: true },
              { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
              { name: 'Nome In-Game', value: atualizacao.nomeInGame, inline: true },
              { name: 'ID', value: atualizacao.id, inline: true },
              { name: 'Novo Cargo', value: cargo?.name || 'Cargo inválido', inline: true },
              { name: 'Solicitado por', value: atualizacao.solicitadoPor, inline: false }
            )
            .setFooter({ text: `ID do Discord: ${userId}` })
            .setTimestamp();

          await canalAprovacao.send({
            embeds: [embed],
            components: [row],
          });
        }

        await interaction.reply({
          content: '✅ Atualização de cargo enviada para aprovação!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_cargo_boas_vindas') {
        const cargoIds = interaction.values;

        const config = await serverService.getConfig(interaction.guild.id);
        config.boas_vindas = {
          ...config.boas_vindas,
          cargo_ids: cargoIds,
        };
        await serverService.saveConfig(interaction.guild.id, config);

        const cargosNomes = cargoIds
          .map(id => interaction.guild.roles.cache.get(id).name)
          .join(', ');

        await interaction.reply({
          content: `✅ Cargos configurados!\n**Cargos:** ${cargosNomes}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'painel_boas_vindas' || interaction.customId === 'painel_registro') {
        const valor = interaction.values[0];

        if (valor === 'config_boas_vindas') {
          const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

          const subcomandos = new StringSelectMenuBuilder()
            .setCustomId('painel_boas_vindas_sub')
            .setPlaceholder('Selecione o que quer configurar...')
            .addOptions(
              {
                label: 'Canal de Boas-vindas',
                value: 'bv_canal',
                description: 'Onde mostra mensagem de boas-vindas',
              },
              {
                label: 'Canal de Saídas',
                value: 'bv_canal_saidas',
                description: 'Registra quando alguém sai',
              },
              {
                label: 'Cargo Visitante',
                value: 'bv_cargo',
                description: 'Cargo dado ao entrar',
              },
              {
                label: 'Mensagem e Banner',
                value: 'bv_mensagem',
                description: 'Configurar texto e imagem',
              },
              {
                label: 'Mensagem de Saída',
                value: 'bv_mensagem_saida',
                description: 'Configurar texto de quando alguém sai',
              }
            );

          const row = new ActionRowBuilder().addComponents(subcomandos);

          await interaction.reply({
            content: '**👋 Boas-vindas**\n\nO que você deseja configurar?',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'config_registro') {
          const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada no servidor.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_registro')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**📋 Canal de Registro**\n\n**Passo 1:** Selecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'config_notificacoes') {
          const { StringSelectMenuBuilder } = require('discord.js');
          const config = await serverService.getConfig(interaction.guild.id);
          const cargoIds = config.cargos_disponiveis || [];

          const cargos = cargoIds
            .map(id => interaction.guild.roles.cache.get(id))
            .filter(role => role)
            .map(role => ({
              label: role.name,
              value: role.id,
              description: `Posição: ${role.position}`,
            }));

          if (cargos.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum cargo foi pré-selecionado. Configure em /admin_bot gerenciar_cargos',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_cargo_notificacoes')
            .setPlaceholder('Selecione os cargos que serão notificados...')
            .setMinValues(1)
            .setMaxValues(Math.min(cargos.length, 25))
            .addOptions(cargos);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**🔔 Notificações**\n\nSelecione quais cargos serão notificados de novos registros:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'config_reg_canal_registro') {
          const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_reg_canal_registro')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**Canal de Registro**\n\n**Passo 1:** Selecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'config_reg_canal_aprovacoes') {
          const { StringSelectMenuBuilder, ChannelType } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_categoria_reg_canal_aprovacoes')
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**Canal de Aprovações**\n\nSelecione a categoria:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'config_aprovacoes') {
          const { StringSelectMenuBuilder } = require('discord.js');
          const config = await serverService.getConfig(interaction.guild.id);
          const cargoIds = config.cargos_disponiveis || [];

          const cargos = cargoIds
            .map(id => interaction.guild.roles.cache.get(id))
            .filter(role => role)
            .map(role => ({
              label: role.name,
              value: role.id,
              description: `Posição: ${role.position}`,
            }));

          if (cargos.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum cargo foi pré-selecionado. Configure em /admin_bot gerenciar_cargos',
              ephemeral: true,
            });
          }

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_cargo_aprovacoes')
            .setPlaceholder('Selecione os cargos que podem aprovar...')
            .setMinValues(1)
            .setMaxValues(Math.min(cargos.length, 25))
            .addOptions(cargos);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: '**✅ Aprovações**\n\nSelecione quais cargos podem aprovar registros:',
            components: [row],
            ephemeral: true,
          });
        }

        if (valor === 'config_status') {
          const config = await serverService.getConfig(interaction.guild.id);
          const boasVindas = config.boas_vindas ? '✅ Configurado' : '❌ Não configurado';
          const registro = config.registro ? '✅ Configurado' : '❌ Não configurado';
          const notificacoes = config.notificacoes ? '✅ Configurado' : '❌ Não configurado';
          const aprovacoes = config.aprovacoes ? '✅ Configurado' : '❌ Não configurado';
          const validacoes = config.validacoes ? '✅ Configurado' : '❌ Não configurado';

          const embed = new EmbedBuilder()
            .setTitle('✅ Status das Configurações')
            .setColor(0x2ecc71)
            .addFields(
              { name: '👋 Boas-vindas', value: boasVindas },
              { name: '📋 Registro', value: registro },
              { name: '🔔 Notificações', value: notificacoes },
              { name: '✅ Aprovações', value: aprovacoes },
              { name: '🛡️ Validações', value: validacoes }
            );

          await interaction.reply({
            embeds: [embed],
            ephemeral: true,
          });
        }
      }

      // ===== HANDLERS DE SELEÇÃO PARA LIMPEZA =====

      if (interaction.customId === 'painel_recrutamento') {
        try {
          const valor = interaction.values[0];
          const { ChannelType, StringSelectMenuBuilder } = require('discord.js');

          const categorias = interaction.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .map(cat => ({
              label: cat.name,
              value: cat.id,
              description: `${cat.children.cache.size} canais`,
            }));

          if (categorias.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhuma categoria encontrada.',
              ephemeral: true,
            });
          }

          const titulos = {
            rec_canal_uniforme: 'Canal de Uniforme',
            rec_canal_regras_fac: 'Canal de Regras da Fac',
            rec_canal_regras_cidade: 'Canal de Regras da Cidade',
          };

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_categoria_recrutamento_${valor}`)
            .setPlaceholder('Selecione a categoria...')
            .addOptions(categorias);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: `**Passo 1:** ${titulos[valor]}\n\nSelecione a categoria:`,
            components: [row],
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em painel_recrutamento:', err);
          await interaction.reply({
            content: '❌ Erro ao processar recrutamento',
            ephemeral: true,
          });
        }
      }

      // Selecionar categoria de recrutamento
      if (interaction.customId.startsWith('select_categoria_recrutamento_')) {
        try {
          const categoriaId = interaction.values[0];
          const tipo = interaction.customId.replace('select_categoria_recrutamento_', '');
          const { ChannelType, StringSelectMenuBuilder } = require('discord.js');

          const categoria = interaction.guild.channels.cache.get(categoriaId);
          if (!categoria) {
            return await interaction.reply({
              content: '❌ Categoria não encontrada.',
              ephemeral: true,
            });
          }

          const canais = categoria.children.cache
            .filter(ch => ch.type === ChannelType.GuildText)
            .map(canal => ({
              label: `#${canal.name}`,
              value: canal.id,
              description: canal.topic || 'Sem descrição',
            }));

          if (canais.length === 0) {
            return await interaction.reply({
              content: '❌ Nenhum canal de texto encontrado nesta categoria.',
              ephemeral: true,
            });
          }

          const titulos = {
            rec_canal_uniforme: 'Canal de Uniforme',
            rec_canal_regras_fac: 'Canal de Regras da Fac',
            rec_canal_regras_cidade: 'Canal de Regras da Cidade',
          };

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_canal_recrutamento_${tipo}`)
            .setPlaceholder('Selecione o canal...')
            .addOptions(canais.slice(0, 25));

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: `**Passo 2:** ${titulos[tipo]}\n\nSelecione o canal em **${categoria.name}**:`,
            components: [row],
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em select_categoria_recrutamento:', err);
          await interaction.reply({
            content: '❌ Erro ao selecionar categoria',
            ephemeral: true,
          });
        }
      }

      // Selecionar canal de recrutamento
      if (interaction.customId.startsWith('select_canal_recrutamento_')) {
        try {
          const canalId = interaction.values[0];
          const tipo = interaction.customId.replace('select_canal_recrutamento_', '');

          const config = await serverService.getConfig(interaction.guild.id);
          if (!config.recrutamento) config.recrutamento = {};

          config.recrutamento[tipo] = canalId;
          await serverService.saveConfig(interaction.guild.id, config);

          const canal = interaction.guild.channels.cache.get(canalId);

          const titulos = {
            rec_canal_uniforme: 'Uniforme',
            rec_canal_regras_fac: 'Regras da Fac',
            rec_canal_regras_cidade: 'Regras da Cidade',
          };

          await interaction.reply({
            content: `✅ ${titulos[tipo]} configurado!\n**Canal:** #${canal.name}`,
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro em select_canal_recrutamento:', err);
          await interaction.reply({
            content: '❌ Erro ao configurar canal de recrutamento',
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'selecionar_admin_limpar') {
        const opcao = interaction.values[0];
        const { ButtonBuilder, ButtonStyle } = require('discord.js');

        let conteudo = '';
        let customId = '';

        if (opcao === 'admin_cargos_bot') {
          conteudo = `⚠️ **ATENÇÃO!**\n\nVocê está prestes a **limpar os cargos disponíveis do bot**.\n\nIsso vai remover todos os cargos pré-selecionados!\n\n**Tem certeza?**`;
          customId = 'confirmar_limpar_admin_cargos_bot';
        } else if (opcao === 'admin_cargos_sistema') {
          conteudo = `⚠️ **ATENÇÃO!**\n\nVocê está prestes a **limpar os cargos de sistema**:\n• Morador\n• Baú Aberto\n\nIsso vai quebrar o sistema de boas-vindas!\n\n**Tem certeza?**`;
          customId = 'confirmar_limpar_admin_cargos_sistema';
        } else if (opcao === 'admin_cargos_farm') {
          conteudo = `🚨 **ATENÇÃO CRÍTICA!**\n\nVocê está prestes a **limpar TUDO de Cargos Farm**:\n• Farm em Dia\n• Farm Atrasado\n• ADV Farm 1 e 2\n• Responsáveis\n• Permissões (Materiais, Metas, Pagamento)\n\nIsso vai destruir completamente o sistema de farm!\n\n**Tem CERTEZA absoluta?**`;
          customId = 'confirmar_limpar_admin_cargos_farm';
        }

        const botaoConfirmar = new ButtonBuilder()
          .setCustomId(customId)
          .setLabel('✅ Sim, limpar')
          .setStyle(ButtonStyle.Danger);

        const botaoCancelar = new ButtonBuilder()
          .setCustomId('cancelar_limpar')
          .setLabel('❌ Não, manter')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(botaoConfirmar, botaoCancelar);

        await interaction.reply({
          content: conteudo,
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'selecionar_painel_limpar') {
        const opcao = interaction.values[0];
        const { ButtonBuilder, ButtonStyle } = require('discord.js');

        let conteudo = '';
        let customId = '';

        if (opcao === 'painel_boasvindas') {
          conteudo = `⚠️ **ATENÇÃO!**\n\nVocê está prestes a **limpar as configurações de Boas-vindas**:\n• Canal de boas-vindas\n• Texto de boas-vindas\n• Banner\n• Cargos visitantes\n\n**Tem certeza?**`;
          customId = 'confirmar_limpar_bv';
        } else if (opcao === 'painel_registro') {
          conteudo = `⚠️ **ATENÇÃO!**\n\nVocê está prestes a **limpar as configurações de Registro**:\n• Canal de registro\n• Descrição\n\n**Tem certeza?**`;
          customId = 'confirmar_limpar_registro';
        } else if (opcao === 'painel_farm') {
          conteudo = `⚠️ **ATENÇÃO!**\n\nVocê está prestes a **limpar as configurações de Farm**:\n• Categoria de baús\n• Canal de aprovações\n• Items\n• Metas\n• Entregas\n\nIsso vai desativar o sistema de farm!\n\n**Tem certeza?**`;
          customId = 'confirmar_limpar_farm_painel';
        } else if (opcao === 'painel_tudo') {
          conteudo = `🚨 **ATENÇÃO CRÍTICA!**\n\nVocê está prestes a **limpar TUDO**:\n• Boas-vindas\n• Registro\n• Farm\n\nIsso vai desativar TODOS os sistemas!\n\n**Tem CERTEZA absoluta?**`;
          customId = 'confirmar_limpar_painel_tudo';
        }

        const botaoConfirmar = new ButtonBuilder()
          .setCustomId(customId)
          .setLabel('✅ Sim, limpar')
          .setStyle(ButtonStyle.Danger);

        const botaoCancelar = new ButtonBuilder()
          .setCustomId('cancelar_limpar')
          .setLabel('❌ Não, manter')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(botaoConfirmar, botaoCancelar);

        await interaction.reply({
          content: conteudo,
          components: [row],
          ephemeral: true,
        });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('aprovar_registro_')) {
        const userId = interaction.customId.replace('aprovar_registro_', '');
        const guildId = interaction.guild.id;
        const config = await serverService.getConfig(interaction.guild.id);

        const cargosAprovacaoIds = config.aprovacoes?.cargo_ids || [];
        const temPermissaoAprovar = cargosAprovacaoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAprovacaoIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissaoAprovar) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para aprovar registros!',
            ephemeral: true,
          });
        }

        try {
          // 1. Registrar servidor no banco
          await serverService.registerServer(
            guildId,
            interaction.guild.name,
            interaction.guild.ownerId
          );

          const membro = await interaction.guild.members.fetch(userId);

          // Pegar dados do registro
          const registroDados = config.registros_pendentes?.[userId];
          if (registroDados) {
            const nomeFormatado = `${registroDados.nomeInGame} | ${registroDados.id}`;

            // Mudar nickname da pessoa
            await membro.setNickname(nomeFormatado);

            // 2. Salvar membro no banco PostgreSQL
            await memberService.saveMember(
              guildId,
              userId,
              registroDados.nomeInGame,
              registroDados.id,
              nomeFormatado
            );

            // 3. Aprovar membro no banco
            await memberService.approveMember(guildId, userId);

            // Remover do registro pendente (JSON)
            delete config.registros_pendentes[userId];
          }

          // O cargo Morador só é dado quando a pessoa abre o baú (abrir_bau),
          // não aqui na aprovação do registro

          // 4. Registrar ação no log
          await serverService.logAction(
            guildId,
            interaction.user.id,
            'aprovacao_registro',
            `Registr do membro ${membro.user.tag} aprovado`
          );

          await serverService.saveConfig(interaction.guild.id, config);

          // Notificar aprovação: por DM (só a pessoa vê), com fallback pro
          // canal de registro caso a DM esteja bloqueada
          const canalRegistroId = config.boas_vindas?.canal_registro_id;
          const canalBauId = config.farm?.canal_bau_id;

          let conteudoAprovacao = `✅ Seu registro em **${interaction.guild.name}** foi **APROVADO**!\n\n`;
          conteudoAprovacao += `🎯 **Próximo passo:** vá até `;
          conteudoAprovacao += canalBauId ? `<#${canalBauId}>` : 'o canal de baú';
          conteudoAprovacao += ` e clique no botão **📦 Abrir Baú** para abrir seu baú de farm!\n`;

          let dmEnviada = false;
          try {
            await membro.user.send({ content: conteudoAprovacao });
            dmEnviada = true;
          } catch (err) {
            console.warn('Não foi possível notificar aprovação por DM:', err.message);
          }

          if (!dmEnviada && canalRegistroId) {
            const canalRegistro = interaction.guild.channels.cache.get(canalRegistroId);
            if (canalRegistro) {
              try {
                const msg = await canalRegistro.send({
                  content: `✅ <@${userId}>, ${conteudoAprovacao}`,
                });

                // Guardar ID da mensagem para deletar depois (ainda em JSON por enquanto)
                if (!config.membros_info) config.membros_info = {};
                if (!config.membros_info[userId]) config.membros_info[userId] = {};
                config.membros_info[userId].mensagem_aprovacao_id = msg.id;
                await serverService.saveConfig(interaction.guild.id, config);
              } catch (err) {
                console.error('Erro ao enviar notificação no canal de registro:', err.message);
              }
            }
          }

          await interaction.reply({
            content: `✅ Registro de ${membro.user.tag} aprovado!`,
            ephemeral: true,
          });

          // Editar o embed da mensagem para marcar como aprovado
          await interaction.message.edit({ components: [] });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao aprovar: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('rejeitar_registro_')) {
        const userId = interaction.customId.replace('rejeitar_registro_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        const cargosAprovacaoIds = config.aprovacoes?.cargo_ids || [];
        const temPermissaoAprovar = cargosAprovacaoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAprovacaoIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissaoAprovar) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para rejeitar registros!',
            ephemeral: true,
          });
        }

        try {
          const user = await interaction.client.users.fetch(userId);

          await user.send('❌ Seu registro foi rejeitado. Tente novamente mais tarde.').catch(() => {});

          await interaction.reply({
            content: `✅ Registro de ${user.tag} rejeitado!`,
            ephemeral: true,
          });

          // Remover os botões da mensagem
          await interaction.message.edit({ components: [] });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao rejeitar: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('aprovar_atualizacao_')) {
        const userId = interaction.customId.replace('aprovar_atualizacao_', '');
        const config = await serverService.getConfig(interaction.guild.id);
        const atualizacao = config.atualizacoes_pendentes?.[userId];

        if (!atualizacao) {
          return await interaction.reply({
            content: '❌ Atualização não encontrada.',
            ephemeral: true,
          });
        }

        try {
          const member = await interaction.guild.members.fetch(userId);

          // Atualizar dados
          if (!config.membros_info) config.membros_info = {};
          config.membros_info[userId] = {
            ...config.membros_info[userId],
            nomeInGame: atualizacao.nomeInGame,
            id: atualizacao.id,
          };

          // Se atualizou cargo, adicionar novo
          if (atualizacao.novo_cargo_id) {
            const novoCargoId = atualizacao.novo_cargo_id;
            const novoCargoObj = interaction.guild.roles.cache.get(novoCargoId);
            if (novoCargoObj) {
              await member.roles.add(novoCargoObj);
              console.log(`✅ Cargo atualizado para ${member.user.tag}: ${novoCargoObj.name}`);
            }
          }

          await serverService.saveConfig(interaction.guild.id, config);
          delete config.atualizacoes_pendentes[userId];
          await serverService.saveConfig(interaction.guild.id, config);

          await member.send('✅ Sua atualização de registro foi aprovada!').catch(() => {});

          await interaction.reply({
            content: `✅ Atualização de ${member.user.tag} aprovada!`,
            ephemeral: true,
          });

          // Remover os botões da mensagem
          await interaction.message.edit({ components: [] });
        } catch (err) {
          console.error(`❌ Erro ao aprovar atualização:`, err.message);
          await interaction.reply({
            content: `❌ Erro ao aprovar: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('recusar_atualizacao_')) {
        const userId = interaction.customId.replace('recusar_atualizacao_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        try {
          const user = await interaction.client.users.fetch(userId);

          await user.send('❌ Sua atualização de registro foi rejeitada. Tente novamente mais tarde.').catch(() => {});

          await interaction.reply({
            content: `✅ Atualização de ${user.tag} rejeitada!`,
            ephemeral: true,
          });

          // Remover os botões da mensagem e dados
          await interaction.message.edit({ components: [] });
          delete config.atualizacoes_pendentes[userId];
          await serverService.saveConfig(interaction.guild.id, config);
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao rejeitar: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('aprovar_promocao_')) {
        const userId = interaction.customId.replace('aprovar_promocao_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        const cargosAprovacaoIds = config.aprovacoes?.cargo_ids || [];
        const temPermissaoAprovar = cargosAprovacaoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAprovacaoIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissaoAprovar) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para aprovar essa solicitação!',
            ephemeral: true,
          });
        }

        const solicitacao = config.atualizacoes_hierarquia_pendentes?.[userId];

        if (!solicitacao) {
          return await interaction.reply({
            content: '❌ Solicitação não encontrada (pode já ter sido processada).',
            ephemeral: true,
          });
        }

        // Atualização de dados sem promoção: não mexe em cargo nenhum
        if (solicitacao.tierAlvo === 'manter') {
          try {
            await atualizarDadosMembro(config, interaction.guild, userId, solicitacao);
            await serverService.saveConfig(interaction.guild.id, config);

            await interaction.reply({
              content: `✅ Dados de <@${userId}> atualizados!`,
              ephemeral: true,
            });

            await interaction.message.edit({ components: [] });
          } catch (err) {
            console.error(err);
            await interaction.reply({
              content: `❌ Erro ao atualizar dados: ${err.message}`,
              ephemeral: true,
            });
          }
          return;
        }

        const candidatosPorTier = {
          membro: config.cargo_membro_id ? [config.cargo_membro_id] : [],
          gerente: config.cargo_gerente_ids || [],
          lideranca: config.cargo_lideranca_ids || [],
        };
        const candidatos = candidatosPorTier[solicitacao.tierAlvo] || [];

        if (candidatos.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo configurado para esse tier. Contate um administrador.',
            ephemeral: true,
          });
        }

        try {
          if (candidatos.length === 1) {
            // Só há um cargo possível: conceder direto
            await concederPromocaoHierarquia(config, interaction.guild, userId, solicitacao, candidatos[0], interaction.user.id);
            await serverService.saveConfig(interaction.guild.id, config);

            await interaction.reply({
              content: `✅ Promoção de <@${userId}> aprovada!`,
              ephemeral: true,
            });

            await interaction.message.edit({ components: [] });
            return;
          }

          // Múltiplos cargos possíveis para esse tier: aprovador escolhe qual conceder
          const { StringSelectMenuBuilder } = require('discord.js');
          const opcoes = candidatos
            .map(id => interaction.guild.roles.cache.get(id))
            .filter(Boolean)
            .map(role => ({ label: role.name, value: role.id }));

          if (opcoes.length === 0) {
            return await interaction.reply({
              content: '❌ Os cargos configurados não foram encontrados no servidor.',
              ephemeral: true,
            });
          }

          // Guardar referência da mensagem original para limpar os botões depois
          solicitacao.canal_id = interaction.channel.id;
          solicitacao.mensagem_id = interaction.message.id;
          await serverService.saveConfig(interaction.guild.id, config);

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_grantrole_promocao_${userId}`)
            .setPlaceholder('Selecione qual cargo conceder...')
            .addOptions(opcoes);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          await interaction.reply({
            content: `Esse tier tem mais de um cargo configurado. Selecione qual conceder a <@${userId}>:`,
            components: [row],
            ephemeral: true,
          });
        } catch (err) {
          console.error('Erro ao aprovar promoção:', err);
          await interaction.reply({
            content: `❌ Erro ao aprovar: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('recusar_promocao_')) {
        const userId = interaction.customId.replace('recusar_promocao_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        const cargosAprovacaoIds = config.aprovacoes?.cargo_ids || [];
        const temPermissaoAprovar = cargosAprovacaoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAprovacaoIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissaoAprovar) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para recusar essa solicitação!',
            ephemeral: true,
          });
        }

        try {
          if (config.atualizacoes_hierarquia_pendentes?.[userId]) {
            delete config.atualizacoes_hierarquia_pendentes[userId];
            await serverService.saveConfig(interaction.guild.id, config);
          }

          const user = await interaction.client.users.fetch(userId);
          await user.send('❌ Sua solicitação de promoção foi recusada.').catch(() => {});

          await interaction.reply({
            content: `✅ Solicitação de <@${userId}> recusada!`,
            ephemeral: true,
          });

          await interaction.message.edit({ components: [] });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao recusar: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'abrir_bau') {
        try {
          const config = await serverService.getConfig(interaction.guild.id);
          const guildId = interaction.guild.id;

          // Validar se está no servidor
          if (!interaction.guild || !interaction.member) {
            return await interaction.reply({
              content: '❌ Você precisa estar no servidor para abrir o baú!',
              ephemeral: true,
            });
          }

          const categoria_bau_id = config.farm?.categoria_bau_id;
          const cargo_bau_aberto_id = config.cargo_bau_aberto_id;
          const cargo_bau_nao_aberto_id = config.cargo_bau_nao_aberto_id;
          const cargo_morador_id = config.cargo_morador_id;
          const cargo_membro_id = config.cargo_membro_id;
          const cargo_gerente_ids = config.cargo_gerente_ids || [];
          const cargo_lideranca_ids = config.cargo_lideranca_ids || [];
          const cargo_farm_em_dia_id = config.farm?.cargo_em_dia_id;

          // Verificar se o registro foi aprovado (via banco PostgreSQL)
          // OU se já possui um cargo da hierarquia (Morador/Membro/Gerente/Liderança) -
          // nesses casos o registro já passou por aprovação em algum momento,
          // mesmo que o registro formal no banco não exista (ex: cargo atribuído manualmente)
          const registroAprovado = await memberService.isMemberApproved(guildId, interaction.user.id);
          const jaTemCargoHierarquia =
            (cargo_morador_id && interaction.member.roles.cache.has(cargo_morador_id)) ||
            (cargo_membro_id && interaction.member.roles.cache.has(cargo_membro_id)) ||
            cargo_gerente_ids.some(id => interaction.member.roles.cache.has(id)) ||
            cargo_lideranca_ids.some(id => interaction.member.roles.cache.has(id));

          if (!registroAprovado && !jaTemCargoHierarquia) {
            return await interaction.reply({
              content: '❌ Seu registro ainda não foi aprovado! Aguarde a análise da administração.',
              ephemeral: true,
            });
          }

          if (!cargo_bau_aberto_id || !cargo_morador_id) {
            return await interaction.reply({
              content: '❌ Cargos do sistema não foram configurados.',
              ephemeral: true,
            });
          }

          // Verificar se já tem o cargo "Baú Aberto"
          if (interaction.member.roles.cache.has(cargo_bau_aberto_id)) {
            // Tentar achar o canal privado dela na categoria de baú
            let canalDoBau = buscarCanalFarmDoUsuario(interaction.guild, config, interaction.user.id);

            // Se o canal foi deletado, recriar com a mensagem completa
            if (!canalDoBau && categoria_bau_id) {
              try {
                const embedRecriado = montarEmbedBauAberto(config, interaction.member, false, false);
                canalDoBau = await criarCanalPrivadoFarm(interaction.guild, config, interaction.user.id, categoria_bau_id, embedRecriado);
              } catch (err) {
                console.error('⚠️ Erro ao recriar canal de farm:', err.message);
              }
            }

            const canalDoBauMsg = canalDoBau ? `\n\n📍 Seu canal de farm: <#${canalDoBau.id}>` : '';

            return await interaction.reply({
              content: `✅ Você já abriu seu baú!${canalDoBauMsg}`,
              ephemeral: true,
            });
          }

          // Pegar cargos
          const cargoBAU = interaction.guild.roles.cache.get(cargo_bau_aberto_id);
          const cargoMORADOR = interaction.guild.roles.cache.get(cargo_morador_id);
          const cargoFarmEmDia = cargo_farm_em_dia_id ? interaction.guild.roles.cache.get(cargo_farm_em_dia_id) : null;

          if (!cargoBAU) {
            return await interaction.reply({
              content: '❌ Cargos não encontrados no servidor.',
              ephemeral: true,
            });
          }

          // Verificar se é visitante
          const cargoVisitantesIds = config.boas_vindas?.cargo_ids || [];
          const temCargoVisitante = interaction.member.roles.cache.some(role =>
            cargoVisitantesIds.includes(role.id)
          );

          try {
            // Cargos a adicionar sempre
            const cargosAdicionar = [cargoBAU];

            // Apenas adicionar Morador se for visitante
            if (temCargoVisitante && cargoMORADOR) {
              cargosAdicionar.push(cargoMORADOR);
            }

            if (cargoFarmEmDia) cargosAdicionar.push(cargoFarmEmDia);

            // Adicionar cargos
            await interaction.member.roles.add(cargosAdicionar);
            console.log(`✅ Cargos adicionados para ${interaction.user.tag}`);

            // Remover cargo de visitante se tiver
            const cargoRemover = interaction.member.roles.cache.filter(role =>
              cargoVisitantesIds.includes(role.id)
            );
            if (cargoRemover.size > 0) {
              await interaction.member.roles.remove([...cargoRemover.keys()]);
              console.log(`✅ Cargo(s) de visitante removido para ${interaction.user.tag}`);
            }

            // Remover marcação de "Sem Baú Aberto", se tiver
            if (cargo_bau_nao_aberto_id && interaction.member.roles.cache.has(cargo_bau_nao_aberto_id)) {
              await interaction.member.roles.remove(cargo_bau_nao_aberto_id);
              console.log(`✅ Cargo "Sem Baú Aberto" removido para ${interaction.user.tag}`);
            }

            // Log da ação no banco
            await serverService.logAction(
              guildId,
              interaction.user.id,
              'abrir_bau',
              `Baú aberto - Cargos: ${cargosAdicionar.map(c => c.name).join(', ')}`
            );

          } catch (err) {
            console.error(`❌ Erro ao gerenciar cargos:`, err.message);
            return await interaction.reply({
              content: `❌ Erro ao gerenciar cargos: ${err.message}`,
              ephemeral: true,
            });
          }

          // Montar mensagem completa: parabéns, uniformes, regras, metas e prazo
          const embed = montarEmbedBauAberto(config, interaction.member, true, temCargoVisitante);

          // Deletar mensagem de aprovação do canal de registro
          const canalRegistroId = config.boas_vindas?.canal_registro_id;
          const msgAprovacaoId = config.membros_info?.[interaction.user.id]?.mensagem_aprovacao_id;

          console.log(`🔍 Tentando deletar msg. Canal: ${canalRegistroId}, Msg ID: ${msgAprovacaoId}`);

          if (canalRegistroId && msgAprovacaoId) {
            try {
              const canalRegistro = interaction.guild.channels.cache.get(canalRegistroId);
              if (canalRegistro) {
                const msg = await canalRegistro.messages.fetch(msgAprovacaoId);
                await msg.delete();
                console.log(`✅ Mensagem de aprovação deletada para ${interaction.user.tag}`);
              }
            } catch (err) {
              console.warn(`⚠️ Erro ao deletar mensagem de aprovação:`, err.message);
            }
          } else {
            console.warn(`⚠️ Não foi possível deletar: canal=${canalRegistroId}, msgId=${msgAprovacaoId}`);
          }

          // Criar canal privado para a pessoa
          try {
            await criarCanalPrivadoFarm(interaction.guild, config, interaction.user.id, categoria_bau_id, embed);
          } catch (err) {
            console.error(`⚠️ Erro ao criar canal de farm:`, err.message);
          }

          await interaction.reply({
            embeds: [embed],
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao abrir baú: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'entregar_meta') {
        const config = await serverService.getConfig(interaction.guild.id);
        const itens = config.farm?.itens || [];

        if (itens.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum item de farm foi cadastrado ainda.',
            ephemeral: true,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId('modal_entregar_meta')
          .setTitle('📦 Entregar Meta de Farm');

        // Adicionar um campo para cada item (máximo 5)
        for (let i = 0; i < Math.min(itens.length, 5); i++) {
          const item = itens[i];
          const input = new TextInputBuilder()
            .setCustomId(`item_${item.id}`)
            .setLabel(`${item.nome}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Quantidade farmada')
            .setRequired(false);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
        }

        await interaction.showModal(modal);
      }

      // Handler para botões de aprovação de farm
      if (interaction.customId.startsWith('aprovar_farm_')) {
        const entrega_id = interaction.customId.replace('aprovar_farm_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        if (!config.farm?.entregas) {
          return await interaction.reply({
            content: '❌ Erro ao buscar entrega.',
            ephemeral: true,
          });
        }

        const entrega = config.farm.entregas.find((e) => String(e.id) === entrega_id);
        if (!entrega) {
          return await interaction.reply({
            content: '❌ Entrega não encontrada.',
            ephemeral: true,
          });
        }

        try {
          const guildId = interaction.guild.id;
          const membro = await interaction.guild.members.fetch(entrega.usuario_id);
          const cargoAdv1Id = config.farm?.cargo_adv_1;
          const cargoAdv2Id = config.farm?.cargo_adv_2;
          const cargoAtrasadoId = config.farm?.cargo_atrasado_id;
          const cargoEmDiaId = config.farm?.cargo_em_dia_id;
          const cargoGerenteIds = config.cargo_gerente_ids || [];
          const cargoLiderancaIds = config.cargo_lideranca_ids || [];

          // Verificar se é Gerente ou Liderança (exempt de farm delivery e ADV system)
          const temCargoGerente = cargoGerenteIds.some(id => membro.roles.cache.has(id)) ||
            cargoLiderancaIds.some(id => membro.roles.cache.has(id));
          if (temCargoGerente) {
            entrega.status = 'aprovada';
            entrega.data_aprovacao = new Date().toISOString();
            entrega.aprovador_id = interaction.user.id;

            const infoPagamento = await processarPagamentoFarm(config, interaction.guild, entrega, interaction.user.id);

            // Patch atômico só nesta entrega, sem sobrescrever mudanças
            // feitas em outras entregas por aprovações concorrentes
            await serverService.patchEntregaFarm(interaction.guild.id, entrega.id, {
              status: entrega.status,
              data_aprovacao: entrega.data_aprovacao,
              aprovador_id: entrega.aprovador_id,
              pagamento: entrega.pagamento,
            });

            await atualizarHistoricoEntregaFarm(
              interaction.guild,
              entrega,
              0x2ecc71,
              '✅ Aprovada',
              infoPagamento?.valor_total > 0 ? [{ name: '💰 Valor', value: formatarMoeda(infoPagamento.valor_total) }] : []
            );

            let respostaGerente = `✅ Entrega de ${membro.user.tag} aprovada!\n\n(Gerente - isento do sistema de ADV)`;
            if (infoPagamento?.valor_total > 0) {
              respostaGerente += `\n\n💰 **Valor a pagar:** ${formatarMoeda(infoPagamento.valor_total)} (lançado no canal de controle de pagamento)`;
            }

            await interaction.reply({
              content: respostaGerente,
              ephemeral: true,
            });

            // Remover os botões pra não dar pra aprovar de novo (duplicaria o pagamento)
            await interaction.message.edit({ components: [] });

            try {
              let dmGerente = `✅ Sua entrega de farm foi **aprovada**! Parabéns!`;
              if (infoPagamento?.valor_total > 0) {
                dmGerente += `\n\n💰 **Valor a pagar:** ${formatarMoeda(infoPagamento.valor_total)} (aguarde o pagamento ser registrado)`;
              }
              await membro.user.send({
                content: dmGerente,
              });
            } catch (err) {
              console.warn('Não foi possível notificar usuário:', err.message);
            }
            return;
          }

          // Contar quantos ADVs o membro tem (via banco PostgreSQL)
          const totalADVs = await advService.countADVs(guildId, entrega.usuario_id);
          const temAdv1 = membro.roles.cache.has(cargoAdv1Id);
          const temAdv2 = membro.roles.cache.has(cargoAdv2Id);

          // Calcular quanto é devido e quanto foi entregue
          const metas = config.farm?.metas || {};
          let semanasPagas = 0;
          let itemsAindaDevendo = [];

          if (totalADVs > 0) {
            // Calcular para cada item quanto foi entregue vs quanto é devido
            for (const [itemId, entregaData] of Object.entries(entrega.itens)) {
              const meta = metas[itemId]?.meta_semanal || 0;
              if (meta > 0) {
                const quantidadeEntregue = entregaData.quantidade || 0;
                const quantidadeDue = totalADVs * meta;
                const semanasPagasItem = Math.floor(quantidadeEntregue / meta);

                semanasPagas = Math.min(totalADVs, semanasPagasItem);

                if (quantidadeEntregue < quantidadeDue) {
                  const faltando = quantidadeDue - quantidadeEntregue;
                  itemsAindaDevendo.push(`${entregaData.nome}: faltam ${faltando} (${quantidadeEntregue}/${quantidadeDue})`);
                }
              }
            }
          }

          // Determinar quantos ADVs remover
          let advsARemover = semanasPagas;
          if (advsARemover > totalADVs) advsARemover = totalADVs;

          // Se vai remover todos os ADVs e não tem mais, é pagamento completo
          const pagamentoCompleto = advsARemover >= totalADVs && itemsAindaDevendo.length === 0;

          // Remover ADVs (começa por ADV 2, depois ADV 1)
          let advsRemovidos = 0;
          const roleOps = [];
          if (temAdv2 && advsRemovidos < advsARemover) {
            roleOps.push(membro.roles.remove(cargoAdv2Id));
            advsRemovidos++;
          }
          if (temAdv1 && advsRemovidos < advsARemover) {
            roleOps.push(membro.roles.remove(cargoAdv1Id));
            advsRemovidos++;
          }

          // Se não tem mais ADVs, remover Farm Atrasado e adicionar Farm em Dia
          const temAdvAgora = membro.roles.cache.has(cargoAdv1Id) || membro.roles.cache.has(cargoAdv2Id);
          if (!temAdvAgora && advsARemover > 0) {
            if (cargoAtrasadoId && membro.roles.cache.has(cargoAtrasadoId)) {
              roleOps.push(membro.roles.remove(cargoAtrasadoId));
            }
            if (cargoEmDiaId) {
              roleOps.push(membro.roles.add(cargoEmDiaId));
            }
          }

          // Executar todas as operações de role em paralelo
          if (roleOps.length > 0) {
            await Promise.all(roleOps);
          }

          entrega.status = 'aprovada';
          entrega.data_aprovacao = new Date().toISOString();
          entrega.aprovador_id = interaction.user.id;

          const infoPagamento = await processarPagamentoFarm(config, interaction.guild, entrega, interaction.user.id);

          // Patch atômico só nesta entrega, sem sobrescrever mudanças
          // feitas em outras entregas por aprovações concorrentes
          await serverService.patchEntregaFarm(interaction.guild.id, entrega.id, {
            status: entrega.status,
            data_aprovacao: entrega.data_aprovacao,
            aprovador_id: entrega.aprovador_id,
            pagamento: entrega.pagamento,
          });

          await atualizarHistoricoEntregaFarm(
            interaction.guild,
            entrega,
            0x2ecc71,
            '✅ Aprovada',
            infoPagamento?.valor_total > 0 ? [{ name: '💰 Valor', value: formatarMoeda(infoPagamento.valor_total) }] : []
          );

          // Montar mensagem de feedback
          let mensagemFeedback = `✅ Entrega de ${membro.user.tag} aprovada!`;
          if (totalADVs > 0) {
            if (pagamentoCompleto) {
              mensagemFeedback += `\n\n✔️ **Pagamento Total:** Todos os ${totalADVs} ADVs foram removidos!`;
            } else if (advsARemover > 0) {
              const advsAinda = totalADVs - advsARemover;
              mensagemFeedback += `\n\n⚠️ **ADV Removido:** ${advsARemover} ADV(s) pago(s), faltam ${advsAinda}`;
              if (itemsAindaDevendo.length > 0) {
                mensagemFeedback += `\n\n📋 **Ainda Devendo:**\n${itemsAindaDevendo.join('\n')}`;
              }
            }
          }
          if (infoPagamento?.valor_total > 0) {
            mensagemFeedback += `\n\n💰 **Valor a pagar:** ${formatarMoeda(infoPagamento.valor_total)} (lançado no canal de controle de pagamento)`;
          }

          await interaction.reply({
            content: mensagemFeedback,
            ephemeral: true,
          });

          // Remover os botões pra não dar pra aprovar de novo (duplicaria o pagamento)
          await interaction.message.edit({ components: [] });

          // Notificar usuário
          try {
            let dmConteudo = `✅ Sua entrega de farm foi **aprovada**! Parabéns!`;

            if (totalADVs > 0) {
              if (pagamentoCompleto) {
                dmConteudo += `\n\n✔️ **Pagamento Total:** Seus ${totalADVs} ADVs foram removidos!\n🎉 Você está **Farm em Dia**!`;
              } else if (advsARemover > 0) {
                const advsAinda = totalADVs - advsARemover;
                dmConteudo += `\n\n⚠️ **ADV Removido:** ${advsARemover} ADV(s) pago(s)\n❌ Faltam ainda ${advsAinda} ADV(s) para pagar`;
                if (itemsAindaDevendo.length > 0) {
                  dmConteudo += `\n\n📋 **Você ainda deve:**\n${itemsAindaDevendo.join('\n')}`;
                }
              }
            }
            if (infoPagamento?.valor_total > 0) {
              dmConteudo += `\n\n💰 **Valor a pagar:** ${formatarMoeda(infoPagamento.valor_total)} (aguarde o pagamento ser registrado)`;
            }

            await membro.user.send({
              content: dmConteudo,
            });
          } catch (err) {
            console.warn('Não foi possível notificar usuário:', err.message);
          }
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao aprovar entrega: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      // Handler para botões de rejeição de farm
      if (interaction.customId.startsWith('recusar_farm_')) {
        const entrega_id = interaction.customId.replace('recusar_farm_', '');

        const modal = new ModalBuilder()
          .setCustomId(`modal_recusar_farm_${entrega_id}`)
          .setTitle('❌ Motivo da Rejeição');

        const motivo = new TextInputBuilder()
          .setCustomId('motivo_rejeicao')
          .setLabel('Explique o motivo da rejeição')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(motivo));
        await interaction.showModal(modal);
      }

      // Handler para modal de rejeição
      if (interaction.customId.startsWith('modal_recusar_farm_')) {
        const entrega_id = interaction.customId.replace('modal_recusar_farm_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        if (!config.farm?.entregas) {
          return await interaction.reply({
            content: '❌ Erro ao buscar entrega.',
            ephemeral: true,
          });
        }

        const entrega = config.farm.entregas.find((e) => String(e.id) === entrega_id);
        if (!entrega) {
          return await interaction.reply({
            content: '❌ Entrega não encontrada.',
            ephemeral: true,
          });
        }

        try {
          const motivo = interaction.fields.getTextInputValue('motivo_rejeicao');
          const membro = await interaction.guild.members.fetch(entrega.usuario_id);

          entrega.status = 'rejeitada';
          entrega.data_rejeicao = new Date().toISOString();
          entrega.rejeitador_id = interaction.user.id;
          entrega.motivo_rejeicao = motivo;

          // Patch atômico só nesta entrega, sem sobrescrever mudanças
          // feitas em outras entregas por aprovações concorrentes
          await serverService.patchEntregaFarm(interaction.guild.id, entrega.id, {
            status: entrega.status,
            data_rejeicao: entrega.data_rejeicao,
            rejeitador_id: entrega.rejeitador_id,
            motivo_rejeicao: entrega.motivo_rejeicao,
          });

          await atualizarHistoricoEntregaFarm(
            interaction.guild,
            entrega,
            0xe74c3c,
            '❌ Recusada',
            [{ name: '📝 Motivo', value: motivo }]
          );

          await interaction.reply({
            content: `❌ Entrega de ${membro.user.tag} rejeitada.`,
            ephemeral: true,
          });

          // Notificar usuário
          try {
            await membro.user.send({
              content: `❌ Sua entrega de farm foi **rejeitada**.\n\n**Motivo:** ${motivo}`,
            });
          } catch (err) {
            console.warn('Não foi possível notificar usuário:', err.message);
          }
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao rejeitar entrega: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('marcar_pago_')) {
        const entrega_id = interaction.customId.replace('marcar_pago_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        const cargoPagamentoIds = config.farm?.cargo_pagamento || [];
        const temPermissao = cargoPagamentoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargoPagamentoIds.includes(role.id));

        if (!temPermissao) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para registrar pagamentos.',
            ephemeral: true,
          });
        }

        const entrega = config.farm?.entregas?.find((e) => String(e.id) === entrega_id);
        if (!entrega || !entrega.pagamento) {
          return await interaction.reply({
            content: '❌ Lançamento de pagamento não encontrado.',
            ephemeral: true,
          });
        }

        if (entrega.pagamento.status === 'pago') {
          return await interaction.reply({
            content: '⚠️ Este pagamento já foi registrado como pago.',
            ephemeral: true,
          });
        }

        try {
          entrega.pagamento.status = 'pago';
          entrega.pagamento.pago_por_id = interaction.user.id;
          entrega.pagamento.data_pagamento = new Date().toISOString();

          // Patch atômico só nesta entrega, sem sobrescrever mudanças
          // feitas em outras entregas por pagamentos concorrentes
          await serverService.patchEntregaFarm(interaction.guild.id, entrega.id, {
            pagamento: entrega.pagamento,
          });

          await atualizarHistoricoEntregaFarm(
            interaction.guild,
            entrega,
            0x2ecc71,
            '💰 Paga',
            [{ name: '💰 Valor Pago', value: formatarMoeda(entrega.pagamento.valor_total) }]
          );

          // Atualizar a mensagem de controle de pagamento
          try {
            const embedAtual = interaction.message.embeds[0];
            const embedPago = EmbedBuilder.from(embedAtual)
              .setColor(0x2ecc71)
              .setTitle('✅ Pagamento Realizado')
              .addFields({ name: '💰 Pago por', value: `<@${interaction.user.id}>`, inline: false });

            await interaction.update({ embeds: [embedPago], components: [] });
          } catch (err) {
            console.warn('Não foi possível atualizar mensagem de pagamento:', err.message);
            await interaction.reply({
              content: `✅ Pagamento de ${formatarMoeda(entrega.pagamento.valor_total)} registrado!`,
              ephemeral: true,
            });
          }

          // Notificar quem entregou o farm (DM + canal privado de farm, já que
          // DM pode estar bloqueada e o canal é sempre acessível)
          const mensagemPagamento = `💰 Seu farm foi **pago**! Valor: ${formatarMoeda(entrega.pagamento.valor_total)}\n📋 Referente à **Entrega #${entrega.id}**`;

          try {
            const membro = await interaction.guild.members.fetch(entrega.usuario_id);
            await membro.user.send({ content: mensagemPagamento });
          } catch (err) {
            console.warn('Não foi possível notificar usuário via DM sobre pagamento:', err.message);
          }

          try {
            const canalFarmUsuario = buscarCanalFarmDoUsuario(interaction.guild, config, entrega.usuario_id);
            if (canalFarmUsuario) {
              await canalFarmUsuario.send({ content: mensagemPagamento });
            }
          } catch (err) {
            console.warn('Não foi possível notificar no canal de farm sobre pagamento:', err.message);
          }
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao registrar pagamento: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      // Handlers de confirmação para metas
      if (interaction.customId === 'confirmar_sobrescrever_meta') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        const config = await serverService.getConfig(interaction.guild.id);
        const itens = config.farm?.itens || [];

        const modal = new ModalBuilder()
          .setCustomId('modal_cadastro_meta')
          .setTitle('🎯 Definir Metas de Farm');

        // Adicionar campo para cada item (máximo 5)
        for (let i = 0; i < Math.min(itens.length, 5); i++) {
          const item = itens[i];
          const metaAtual = config.farm?.metas?.[item.id]?.meta_semanal || '';

          const metaInput = new TextInputBuilder()
            .setCustomId(`meta_${item.id}`)
            .setLabel(`${item.nome} (quantidade/semana)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 100')
            .setValue(metaAtual.toString())
            .setRequired(false);

          modal.addComponents(new ActionRowBuilder().addComponents(metaInput));
        }

        await interaction.showModal(modal);
      }

      if (interaction.customId === 'cancelar_meta') {
        await interaction.reply({
          content: '❌ Operação cancelada. Metas mantidas.',
          ephemeral: true,
        });
      }

      // Handlers de confirmação para pagamentos
      if (interaction.customId === 'confirmar_sobrescrever_pagamento') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        const config = await serverService.getConfig(interaction.guild.id);
        const itens = config.farm?.itens || [];

        const modal = new ModalBuilder()
          .setCustomId('modal_cadastro_pagamento')
          .setTitle('💰 Valor por Unidade');

        // Adicionar campo para cada item (máximo 5, deixe em branco para não elegível)
        for (let i = 0; i < Math.min(itens.length, 5); i++) {
          const item = itens[i];
          const valorAtual = config.farm?.pagamentos?.[item.id]?.valor_unidade ?? '';

          const valorInput = new TextInputBuilder()
            .setCustomId(`valor_${item.id}`)
            .setLabel(`${item.nome} (R$ por unidade)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 1.50 (deixe vazio se não for elegível)')
            .setValue(valorAtual.toString())
            .setRequired(false);

          modal.addComponents(new ActionRowBuilder().addComponents(valorInput));
        }

        await interaction.showModal(modal);
      }

      if (interaction.customId === 'cancelar_pagamento') {
        await interaction.reply({
          content: '❌ Operação cancelada. Valores de pagamento mantidos.',
          ephemeral: true,
        });
      }

      // ===== HANDLERS DE ADV =====

      if (interaction.customId === 'registrar_adv') {
        const config = await serverService.getConfig(interaction.guild.id);
        const guildId = interaction.guild.id;

        // Verificar se o usuário tem permissão para registrar ADV
        const cargosAdvIds = config.farm?.cargo_registro_adv || [];
        const temPermissao = cargosAdvIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAdvIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissao) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para registrar ADVs!',
            ephemeral: true,
          });
        }

        const opcoes = opcoesAdvConfiguradas(config, interaction.guild);
        if (opcoes.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo de ADV foi configurado. Configure em **Cargos de Farm**.',
            ephemeral: true,
          });
        }

        const { StringSelectMenuBuilder } = require('discord.js');
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_tipo_adv_registrar')
          .setPlaceholder('Selecione o tipo de ADV...')
          .addOptions(opcoes);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**⚠️ Registrar ADV**\n\nSelecione qual ADV a pessoa vai receber:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'remover_adv') {
        const config = await serverService.getConfig(interaction.guild.id);

        // Verificar se o usuário tem permissão
        const cargosAdvIds = config.farm?.cargo_registro_adv || [];
        const temPermissao = cargosAdvIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAdvIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissao) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para remover ADVs!',
            ephemeral: true,
          });
        }

        const opcoes = opcoesAdvConfiguradas(config, interaction.guild);
        if (opcoes.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo de ADV foi configurado. Configure em **Cargos de Farm**.',
            ephemeral: true,
          });
        }

        const { StringSelectMenuBuilder } = require('discord.js');
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_tipo_adv_remover')
          .setPlaceholder('Selecione o tipo de ADV...')
          .addOptions(opcoes);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**✅ Remover ADV**\n\nSelecione qual ADV a pessoa vai perder:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith('aprovar_adv_')) {
        const advId = interaction.customId.replace('aprovar_adv_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        const cargosAprovacaoIds = config.farm?.cargo_aprovacao_adv || [];
        const temPermissao = cargosAprovacaoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAprovacaoIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissao) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para aprovar ADVs!',
            ephemeral: true,
          });
        }

        const pendente = config.farm?.advs_pendentes?.[advId];
        if (!pendente) {
          return await interaction.reply({
            content: '❌ Solicitação não encontrada (pode já ter sido processada).',
            ephemeral: true,
          });
        }

        const cargoAdvId = pendente.tipoAdv === 1 ? config.farm?.cargo_adv_1 : config.farm?.cargo_adv_2;
        if (!cargoAdvId) {
          return await interaction.reply({
            content: `❌ Cargo de ADV ${pendente.tipoAdv} não foi configurado.`,
            ephemeral: true,
          });
        }

        try {
          const membro = await interaction.guild.members.fetch(pendente.membroId);
          await membro.roles.add(cargoAdvId);

          // Garantir que existe um registro de membro no banco antes de
          // registrar o ADV (cargo atribuído manualmente sem registro formal)
          const membroExistente = await memberService.getMember(interaction.guild.id, pendente.membroId);
          if (!membroExistente) {
            await memberService.saveMember(interaction.guild.id, pendente.membroId, membro.displayName, null, membro.displayName);
            await memberService.approveMember(interaction.guild.id, pendente.membroId);
          }

          await advService.addADV(interaction.guild.id, pendente.membroId, pendente.tipoAdv, pendente.motivo);

          await serverService.logAction(
            interaction.guild.id,
            interaction.user.id,
            'aprovacao_adv',
            `ADV ${pendente.tipoAdv} aplicado em ${membro.user.tag}: ${pendente.motivo}`
          );

          delete config.farm.advs_pendentes[advId];
          await serverService.saveConfig(interaction.guild.id, config);

          await interaction.reply({
            content: `✅ ADV ${pendente.tipoAdv} aplicado em ${membro.user.tag}!`,
            ephemeral: true,
          });

          await interaction.message.edit({ components: [] });

          try {
            await membro.user.send({
              content: `⚠️ Você recebeu um **ADV ${pendente.tipoAdv}**!\n\n**Motivo:** ${pendente.motivo}`,
            });
          } catch (err) {
            console.warn('Não foi possível notificar usuário sobre ADV:', err.message);
          }
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao aprovar ADV: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('rejeitar_adv_')) {
        const advId = interaction.customId.replace('rejeitar_adv_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        const cargosAprovacaoIds = config.farm?.cargo_aprovacao_adv || [];
        const temPermissao = cargosAprovacaoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAprovacaoIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissao) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para rejeitar ADVs!',
            ephemeral: true,
          });
        }

        const pendente = config.farm?.advs_pendentes?.[advId];
        if (!pendente) {
          return await interaction.reply({
            content: '❌ Solicitação não encontrada (pode já ter sido processada).',
            ephemeral: true,
          });
        }

        try {
          delete config.farm.advs_pendentes[advId];
          await serverService.saveConfig(interaction.guild.id, config);

          await interaction.reply({
            content: '❌ Solicitação de ADV rejeitada.',
            ephemeral: true,
          });

          await interaction.message.edit({ components: [] });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao rejeitar ADV: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('confirmar_remover_adv_')) {
        const advId = interaction.customId.replace('confirmar_remover_adv_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        const cargosAprovacaoIds = config.farm?.cargo_aprovacao_adv || [];
        const temPermissao = cargosAprovacaoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAprovacaoIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissao) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para remover ADVs!',
            ephemeral: true,
          });
        }

        const pendente = config.farm?.remocoes_adv_pendentes?.[advId];
        if (!pendente) {
          return await interaction.reply({
            content: '❌ Solicitação não encontrada (pode já ter sido processada).',
            ephemeral: true,
          });
        }

        const cargoAdvId = pendente.tipoAdv === 1 ? config.farm?.cargo_adv_1 : config.farm?.cargo_adv_2;
        if (!cargoAdvId) {
          return await interaction.reply({
            content: `❌ Cargo de ADV ${pendente.tipoAdv} não foi configurado.`,
            ephemeral: true,
          });
        }

        try {
          const membro = await interaction.guild.members.fetch(pendente.membroId);
          await membro.roles.remove(cargoAdvId);
          await advService.removeADV(interaction.guild.id, pendente.membroId, pendente.tipoAdv);

          await serverService.logAction(
            interaction.guild.id,
            interaction.user.id,
            'remocao_adv',
            `ADV ${pendente.tipoAdv} removido de ${membro.user.tag}`
          );

          delete config.farm.remocoes_adv_pendentes[advId];
          await serverService.saveConfig(interaction.guild.id, config);

          await interaction.reply({
            content: `✅ ADV ${pendente.tipoAdv} removido de ${membro.user.tag}!`,
            ephemeral: true,
          });

          await interaction.message.edit({ components: [] });

          try {
            await membro.user.send({
              content: `✅ Seu **ADV ${pendente.tipoAdv}** foi removido!`,
            });
          } catch (err) {
            console.warn('Não foi possível notificar usuário sobre remoção de ADV:', err.message);
          }
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao remover ADV: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('cancelar_remover_adv_')) {
        const advId = interaction.customId.replace('cancelar_remover_adv_', '');
        const config = await serverService.getConfig(interaction.guild.id);

        const cargosAprovacaoIds = config.farm?.cargo_aprovacao_adv || [];
        const temPermissao = cargosAprovacaoIds.length === 0 ||
          interaction.member.roles.cache.some(role => cargosAprovacaoIds.includes(role.id)) ||
          interaction.memberPermissions.has('ADMINISTRATOR');

        if (!temPermissao) {
          return await interaction.reply({
            content: '❌ Você não tem permissão para cancelar essa remoção!',
            ephemeral: true,
          });
        }

        const pendente = config.farm?.remocoes_adv_pendentes?.[advId];
        if (!pendente) {
          return await interaction.reply({
            content: '❌ Solicitação não encontrada (pode já ter sido processada).',
            ephemeral: true,
          });
        }

        try {
          delete config.farm.remocoes_adv_pendentes[advId];
          await serverService.saveConfig(interaction.guild.id, config);

          await interaction.reply({
            content: '❌ Remoção de ADV cancelada.',
            ephemeral: true,
          });

          await interaction.message.edit({ components: [] });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao cancelar remoção de ADV: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId.startsWith('confirmar_limpar_farm_membro_')) {
        const membroId = interaction.customId.replace('confirmar_limpar_farm_membro_', '');

        try {
          const totalDeletado = await deliveryService.deletarEntregasPorMembro(interaction.guild.id, membroId);

          const config = await serverService.getConfig(interaction.guild.id);
          if (config.farm?.entregas) {
            config.farm.entregas = config.farm.entregas.filter((e) => e.usuario_id !== membroId);
            await serverService.saveConfig(interaction.guild.id, config);
          }

          await serverService.logAction(
            interaction.guild.id,
            interaction.user.id,
            'limpar_farm_membro',
            `${totalDeletado} entrega(s) de <@${membroId}> apagadas`
          );

          await interaction.update({
            content: `✅ **${totalDeletado}** entrega(s) de <@${membroId}> apagada(s). O limite semanal dela foi zerado.`,
            components: [],
          });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao limpar farm: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'cancelar_limpar_farm_membro') {
        await interaction.update({
          content: '❌ Operação cancelada. Nada foi apagado.',
          components: [],
        });
      }

      // ===== PAINEL DE GERENCIAMENTO DE FARM =====

      if (interaction.customId === 'ger_farm_sem_bau') {
        const config = await serverService.getConfig(interaction.guild.id);
        const ids = listarIdsComCargo(interaction.guild, config.cargo_bau_nao_aberto_id);

        if (ids === null) {
          return await interaction.reply({ content: '❌ Cargo "Sem Baú Aberto" não foi configurado.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setTitle(`👥 Sem Baú Aberto (${ids.length})`)
          .setColor(0xe67e22)
          .setDescription(formatarListaMembros(ids));

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.customId === 'ger_farm_bau_aberto') {
        const config = await serverService.getConfig(interaction.guild.id);
        const ids = listarIdsComCargo(interaction.guild, config.cargo_bau_aberto_id);

        if (ids === null) {
          return await interaction.reply({ content: '❌ Cargo "Baú Aberto" não foi configurado.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setTitle(`📦 Baú Aberto (${ids.length})`)
          .setColor(0xFFD700)
          .setDescription(formatarListaMembros(ids));

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.customId === 'ger_farm_em_dia') {
        const config = await serverService.getConfig(interaction.guild.id);
        const ids = listarIdsComCargo(interaction.guild, config.farm?.cargo_em_dia_id);

        if (ids === null) {
          return await interaction.reply({ content: '❌ Cargo "Farm em Dia" não foi configurado.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setTitle(`✅ Farm em Dia (${ids.length})`)
          .setColor(0x2ecc71)
          .setDescription(formatarListaMembros(ids));

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.customId === 'ger_farm_atrasado') {
        const config = await serverService.getConfig(interaction.guild.id);
        const ids = listarIdsComCargo(interaction.guild, config.farm?.cargo_atrasado_id);

        if (ids === null) {
          return await interaction.reply({ content: '❌ Cargo "Farm Atrasado" não foi configurado.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setTitle(`⏸️ Farm Atrasado (${ids.length})`)
          .setColor(0xe74c3c)
          .setDescription(formatarListaMembros(ids));

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.customId === 'ger_farm_adv') {
        const config = await serverService.getConfig(interaction.guild.id);
        const idsAdv1 = listarIdsComCargo(interaction.guild, config.farm?.cargo_adv_1);
        const idsAdv2 = listarIdsComCargo(interaction.guild, config.farm?.cargo_adv_2);

        const embed = new EmbedBuilder()
          .setTitle('⚠️ ADV Farm')
          .setColor(0xe74c3c)
          .addFields(
            {
              name: `ADV 1 (${idsAdv1?.length ?? 0})`,
              value: idsAdv1 === null ? '❌ não configurado' : formatarListaMembros(idsAdv1),
              inline: false,
            },
            {
              name: `ADV 2 (${idsAdv2?.length ?? 0})`,
              value: idsAdv2 === null ? '❌ não configurado' : formatarListaMembros(idsAdv2),
              inline: false,
            }
          );

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.customId === 'ger_farm_metas_semanal') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const desde = deliveryService.inicioDaSemanaAtual();
          const stats = await deliveryService.getEstatisticasEntregas(interaction.guild.id, desde);
          const totaisPorItem = await deliveryService.getTotaisPorItem(interaction.guild.id, desde);
          const ranking = await deliveryService.getRankingEntregas(interaction.guild.id, desde);

          const medalhas = ['🥇', '🥈', '🥉'];
          const linhasRanking = ranking.map((r, i) =>
            `${medalhas[i] || `${i + 1}.`} <@${r.discordId}> — ${r.totalItens.toLocaleString('pt-BR')} unidade(s) (${r.totalEntregas} entrega(s))`
          );
          const listaRanking = formatarListaTruncada(linhasRanking) || 'Nenhuma entrega aprovada essa semana.';

          const embed = new EmbedBuilder()
            .setTitle('🎯 Metas Entregues (Semana)')
            .setColor(0x3498db)
            .setDescription(`**Total:** ${stats.totalEntregas} entrega(s) aprovada(s), ${stats.totalItens.toLocaleString('pt-BR')} unidade(s)\n\n**Ranking:**\n${listaRanking}`)
            .addFields({ name: '📦 Total por Item', value: formatarTotaisPorItem(totaisPorItem), inline: false });

          await interaction.editReply({ embeds: [embed] });
        } catch (err) {
          console.error(err);
          await interaction.editReply({ content: `❌ Erro ao buscar estatísticas: ${err.message}` });
        }
      }

      if (interaction.customId === 'ger_farm_metas_total') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const stats = await deliveryService.getEstatisticasEntregas(interaction.guild.id);
          const totaisPorItem = await deliveryService.getTotaisPorItem(interaction.guild.id);
          const ranking = await deliveryService.getRankingEntregas(interaction.guild.id);

          const medalhas = ['🥇', '🥈', '🥉'];
          const linhasRanking = ranking.map((r, i) =>
            `${medalhas[i] || `${i + 1}.`} <@${r.discordId}> — ${r.totalItens.toLocaleString('pt-BR')} unidade(s) (${r.totalEntregas} entrega(s))`
          );
          const listaRanking = formatarListaTruncada(linhasRanking) || 'Nenhuma entrega aprovada ainda.';

          const embed = new EmbedBuilder()
            .setTitle('📊 Metas Entregues (Total)')
            .setColor(0x3498db)
            .setDescription(`**Total:** ${stats.totalEntregas} entrega(s) aprovada(s), ${stats.totalItens.toLocaleString('pt-BR')} unidade(s)\n\n**Ranking:**\n${listaRanking}`)
            .addFields({ name: '📦 Total por Item', value: formatarTotaisPorItem(totaisPorItem), inline: false });

          await interaction.editReply({ embeds: [embed] });
        } catch (err) {
          console.error(err);
          await interaction.editReply({ content: `❌ Erro ao buscar estatísticas: ${err.message}` });
        }
      }

      if (interaction.customId === 'ger_farm_valor_semanal') {
        const config = await serverService.getConfig(interaction.guild.id);
        const inicioSemana = deliveryService.inicioDaSemanaAtual();
        const porMembro = calcularPagamentosPorMembro(config, (p) => p.status === 'pago' && p.data_pagamento && new Date(p.data_pagamento) >= inicioSemana);
        const totalGeral = porMembro.reduce((soma, m) => soma + m.total, 0);

        const lista = porMembro.length === 0
          ? 'Nenhum pagamento essa semana.'
          : porMembro.map((m) => `<@${m.discordId}> — ${formatarMoeda(m.total)} (${m.qtd} pagamento(s))`).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('💰 Valor Pago (Semana)')
          .setColor(0x2ecc71)
          .setDescription(`**Total geral:** ${formatarMoeda(totalGeral)}\n\n${lista}`);

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.customId === 'ger_farm_valor_total') {
        const config = await serverService.getConfig(interaction.guild.id);
        const porMembro = calcularPagamentosPorMembro(config, (p) => p.status === 'pago');
        const totalGeral = porMembro.reduce((soma, m) => soma + m.total, 0);

        const lista = porMembro.length === 0
          ? 'Nenhum pagamento registrado ainda.'
          : porMembro.map((m) => `<@${m.discordId}> — ${formatarMoeda(m.total)} (${m.qtd} pagamento(s))`).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('💵 Valor Pago (Total)')
          .setColor(0x2ecc71)
          .setDescription(`**Total geral:** ${formatarMoeda(totalGeral)}\n\n${lista}`);

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.customId === 'ger_farm_pendente') {
        const config = await serverService.getConfig(interaction.guild.id);
        const porMembro = calcularPagamentosPorMembro(config, (p) => p.status === 'pendente');
        const totalGeral = porMembro.reduce((soma, m) => soma + m.total, 0);

        const lista = porMembro.length === 0
          ? 'Nenhum pagamento pendente.'
          : porMembro.map((m) => `<@${m.discordId}> — ${formatarMoeda(m.total)} (${m.qtd} pagamento(s))`).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('⏳ Pagamentos Pendentes')
          .setColor(0xe74c3c)
          .setDescription(`**Total geral:** ${formatarMoeda(totalGeral)}\n\n${lista}`);

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // ===== HANDLERS DE LIMPEZA DE CONFIGURAÇÕES =====

      // Limpar IDs do Bot
      if (interaction.customId === 'limpar_config_bot_ids') {
        const { ButtonBuilder, ButtonStyle } = require('discord.js');

        const botaoConfirmar = new ButtonBuilder()
          .setCustomId('confirmar_limpar_ids')
          .setLabel('✅ Sim, limpar')
          .setStyle(ButtonStyle.Danger);

        const botaoCancelar = new ButtonBuilder()
          .setCustomId('cancelar_limpar')
          .setLabel('❌ Não, manter')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(botaoConfirmar, botaoCancelar);

        await interaction.reply({
          content: `⚠️ **ATENÇÃO!**\n\nVocê está prestes a **limpar os IDs do Bot**:\n• Discord Token\n• Client ID\n• Guild ID\n\nIsso vai desativar o bot!\n\n**Tem certeza que deseja continuar?**`,
          components: [row],
          ephemeral: true,
        });
      }

      // Confirmar limpeza de IDs
      if (interaction.customId === 'confirmar_limpar_ids') {
        const config = await serverService.getConfig(interaction.guild.id);
        config.discord_token = '';
        config.client_id = '';
        config.guild_id = '';
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ **IDs do Bot foram deletados!**\n\nO bot precisa ser reconfigurado para funcionar.',
          ephemeral: true,
        });
      }

      // Menu de limpeza do Admin Bot
      if (interaction.customId === 'limpar_config_admin_menu') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('selecionar_admin_limpar')
          .setPlaceholder('Escolha a categoria...')
          .addOptions(
            {
              label: 'Cargos Bot',
              description: 'Cargos disponíveis',
              value: 'admin_cargos_bot',
            },
            {
              label: 'Cargos Sistema',
              description: 'Morador, Baú Aberto, etc.',
              value: 'admin_cargos_sistema',
            },
            {
              label: 'Cargos Farm',
              description: 'Farm em Dia, Atrasado, ADVs, Permissões',
              value: 'admin_cargos_farm',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '🗑️ **Selecione qual categoria deseja limpar:**',
          components: [row],
          ephemeral: true,
        });
      }

      // Menu de limpeza de Painel
      if (interaction.customId === 'limpar_config_painel') {
        const { StringSelectMenuBuilder } = require('discord.js');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('selecionar_painel_limpar')
          .setPlaceholder('Escolha o que limpar...')
          .addOptions(
            {
              label: 'Boas-vindas',
              description: 'Canal, textos, banners',
              value: 'painel_boasvindas',
            },
            {
              label: 'Registro',
              description: 'Configurações de registro',
              value: 'painel_registro',
            },
            {
              label: 'Farm',
              description: 'Categoria, canal, items, metas',
              value: 'painel_farm',
            },
            {
              label: 'Tudo',
              description: 'Limpar TUDO do painel',
              value: 'painel_tudo',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '🗑️ **Selecione o que deseja limpar:**',
          components: [row],
          ephemeral: true,
        });
      }

      // ===== HANDLERS DE CONFIRMAÇÃO DE LIMPEZA =====

      if (interaction.customId === 'cancelar_limpar') {
        await interaction.reply({
          content: '❌ Operação cancelada. Configurações mantidas.',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_admin_cargos_bot') {
        const config = await serverService.getConfig(interaction.guild.id);
        config.cargos_disponiveis = [];
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ **Cargos Bot foram deletados!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_admin_cargos_sistema') {
        const config = await serverService.getConfig(interaction.guild.id);
        config.cargo_morador_id = '';
        config.cargo_bau_aberto_id = '';
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ **Cargos de Sistema foram deletados!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_admin_cargos_farm') {
        const config = await serverService.getConfig(interaction.guild.id);
        config.farm = {
          itens: [],
          metas: {},
          entregas: [],
        };
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ **Cargos Farm foram completamente deletados!**\n\n⚠️ O sistema de farm precisa ser reconfigurado.',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_bv') {
        const config = await serverService.getConfig(interaction.guild.id);
        config.boas_vindas = {};
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ **Boas-vindas foram deletadas!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_registro') {
        const config = await serverService.getConfig(interaction.guild.id);
        config.registro = {};
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ **Registro foi deletado!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_farm_painel') {
        const config = await serverService.getConfig(interaction.guild.id);
        config.farm = {
          itens: [],
          metas: {},
          entregas: [],
        };
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ **Farm foi deletado!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_painel_tudo') {
        const config = await serverService.getConfig(interaction.guild.id);
        config.boas_vindas = {};
        config.registro = {};
        config.farm = {
          itens: [],
          metas: {},
          entregas: [],
        };
        await serverService.saveConfig(interaction.guild.id, config);

        await interaction.reply({
          content: '✅ **Tudo foi deletado!**\n\n⚠️ O painel precisa ser completamente reconfigurado.',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'pegar_roupas') {
        const config = await serverService.getConfig(interaction.guild.id);
        const canalRoupasId = config.farm?.canal_roupas_id;

        if (!canalRoupasId) {
          return await interaction.reply({
            content: '❌ Canal de roupas não foi configurado.',
            ephemeral: true,
          });
        }

        const canalRoupas = interaction.guild.channels.cache.get(canalRoupasId);
        if (!canalRoupas) {
          return await interaction.reply({
            content: '❌ Canal de roupas não encontrado.',
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: `Vá para ${canalRoupas} para pegar as roupas da fac!`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'pedir_registro') {
        const config = await serverService.getConfig(interaction.guild.id);
        const userId = interaction.user.id;

        // Verificar se já tem registro aprovado
        if (config.membros_info?.[userId]) {
          return await interaction.reply({
            content: '❌ Você já tem um registro aprovado! Use **Atualizar Registro** se precisar fazer mudanças.',
            ephemeral: true,
          });
        }

        // Verificar se já está pendente
        if (config.registros_pendentes?.[userId]) {
          return await interaction.reply({
            content: '⏳ Você já tem um registro pendente! Aguarde a análise.',
            ephemeral: true,
          });
        }

        // ===== VALIDAÇÃO HIERÁRQUICA DE CARGOS =====
        // "Pedir Registro" é só para o primeiro registro (Visitante -> Morador).
        // Quem já tem qualquer cargo da hierarquia usa "Atualizar Registro" para
        // pedir a próxima promoção.
        const cargoVisitantesIds = config.boas_vindas?.cargo_ids || [];
        const cargoMoradorId = config.cargo_morador_id;
        const cargoMembroId = config.cargo_membro_id;
        const cargoGerenteIds = config.cargo_gerente_ids || [];
        const cargoLiderancaIds = config.cargo_lideranca_ids || [];

        const temCargoVisitante = interaction.member.roles.cache.some(role =>
          cargoVisitantesIds.includes(role.id)
        );
        const temCargoMorador = cargoMoradorId && interaction.member.roles.cache.has(cargoMoradorId);
        const temCargoMembro = cargoMembroId && interaction.member.roles.cache.has(cargoMembroId);
        const temCargoGerente = cargoGerenteIds.some(id => interaction.member.roles.cache.has(id));
        const temCargoLideranca = cargoLiderancaIds.some(id => interaction.member.roles.cache.has(id));

        if (temCargoMorador || temCargoMembro || temCargoGerente || temCargoLideranca) {
          return await interaction.reply({
            content: '❌ Você já tem um cargo da hierarquia! Use **Atualizar Registro** para solicitar a próxima promoção.',
            ephemeral: true,
          });
        }

        if (!temCargoVisitante) {
          return await interaction.reply({
            content: '❌ Você não possui um cargo elegível para solicitar registro. Contate um administrador.',
            ephemeral: true,
          });
        }

        if (!cargoMoradorId) {
          return await interaction.reply({
            content: '❌ O cargo de promoção (Morador) não foi configurado! Contate um administrador.',
            ephemeral: true,
          });
        }

        const nomeCargo = interaction.guild.roles.cache.get(cargoMoradorId)?.name || 'Morador';

        // Abrir modal de registro
        const modal = new ModalBuilder()
          .setCustomId('modal_registro_membro')
          .setTitle(`📋 Solicitação para ${nomeCargo}`);

        const cargoInput = new TextInputBuilder()
          .setCustomId('cargo_solicitado')
          .setLabel('Cargo Solicitado')
          .setStyle(TextInputStyle.Short)
          .setValue(nomeCargo)
          .setRequired(true);

        const nomeInput = new TextInputBuilder()
          .setCustomId('nome_in_game')
          .setLabel('Seu nome in-game')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: Levi')
          .setRequired(true);

        const idInput = new TextInputBuilder()
          .setCustomId('id_registro')
          .setLabel('Seu ID na cidade')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 1202')
          .setRequired(true);

        const telefoneInput = new TextInputBuilder()
          .setCustomId('telefone_registro')
          .setLabel('Seu telefone (opcional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 1111')
          .setRequired(false);

        const recrutadorInput = new TextInputBuilder()
          .setCustomId('recrutador_registro')
          .setLabel('Quem te recrutou? (opcional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Nome da pessoa')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(cargoInput),
          new ActionRowBuilder().addComponents(nomeInput),
          new ActionRowBuilder().addComponents(idInput),
          new ActionRowBuilder().addComponents(telefoneInput),
          new ActionRowBuilder().addComponents(recrutadorInput)
        );

        await interaction.showModal(modal);
      }

      if (interaction.customId === 'atualizar_registro') {
        const config = await serverService.getConfig(interaction.guild.id);
        const userId = interaction.user.id;

        // Verificar se é visitante
        const cargoVisitantesIds = config.boas_vindas?.cargo_ids || [];
        const temCargoVisitante = interaction.member.roles.cache.some(role =>
          cargoVisitantesIds.includes(role.id)
        );

        if (temCargoVisitante) {
          return await interaction.reply({
            content: '❌ Visitantes não podem atualizar registro! Use **Pedir Registro** primeiro.',
            ephemeral: true,
          });
        }

        // ===== VALIDAÇÃO HIERÁRQUICA DE CARGOS (PARA ATUALIZAR) =====
        const cargoMoradorId = config.cargo_morador_id;
        const cargoMembroId = config.cargo_membro_id;
        const cargoGerenteIds = config.cargo_gerente_ids || [];
        const cargoLiderancaIds = config.cargo_lideranca_ids || [];

        const temCargoMorador = cargoMoradorId && interaction.member.roles.cache.has(cargoMoradorId);
        const temCargoMembro = cargoMembroId && interaction.member.roles.cache.has(cargoMembroId);
        const temCargoGerente = cargoGerenteIds.some(id => interaction.member.roles.cache.has(id));
        const temCargoLideranca = cargoLiderancaIds.some(id => interaction.member.roles.cache.has(id));

        // Verificar se tem registro aprovado no banco OU já possui algum cargo
        // da hierarquia (ex: cargo atribuído manualmente, sem passar pelo fluxo)
        const jaTemCargoHierarquia = temCargoMorador || temCargoMembro || temCargoGerente || temCargoLideranca;
        if (!config.membros_info?.[userId] && !jaTemCargoHierarquia) {
          return await interaction.reply({
            content: '❌ Você ainda não tem um registro aprovado! Use **Pedir Registro** para se registrar.',
            ephemeral: true,
          });
        }

        // Determinar qual tier a pessoa pode solicitar em seguida (se houver).
        // Gerente/Liderança podem ter vários cargos possíveis - o cargo
        // específico só é escolhido pelo aprovador no momento da aprovação.
        let tierAlvo = null;
        let nomeCargoProximo = '';

        if (temCargoLideranca) {
          // Liderança já é o topo - não tem próximo tier, mas ainda pode atualizar dados
        } else if (temCargoGerente) {
          tierAlvo = 'lideranca';
          nomeCargoProximo = 'Liderança';
        } else if (temCargoMembro) {
          tierAlvo = 'gerente';
          nomeCargoProximo = 'Gerente';
        } else if (temCargoMorador) {
          tierAlvo = 'membro';
          const role = interaction.guild.roles.cache.get(cargoMembroId);
          nomeCargoProximo = role?.name || 'Membro';
        } else {
          return await interaction.reply({
            content: '❌ Você não possui um cargo elegível para atualizar registro. Você já possui outros cargos no servidor que não fazem parte dessa hierarquia (Visitante/Morador/Membro/Gerente/Liderança).',
            ephemeral: true,
          });
        }

        // Só oferece a opção de promoção se o próximo tier tiver cargo configurado
        const temCargoConfiguradoParaTier = tierAlvo && (
          (tierAlvo === 'membro' && cargoMembroId) ||
          (tierAlvo === 'gerente' && cargoGerenteIds.length > 0) ||
          (tierAlvo === 'lideranca' && cargoLiderancaIds.length > 0)
        );

        const { StringSelectMenuBuilder } = require('discord.js');
        const opcoes = [
          {
            label: 'Atualizar Nome/ID',
            description: 'Mantém seu cargo atual, só corrige seus dados',
            value: 'manter',
          },
        ];

        if (temCargoConfiguradoParaTier) {
          opcoes.push({
            label: `Solicitar Promoção para ${nomeCargoProximo}`,
            description: 'Pede a próxima promoção da hierarquia',
            value: tierAlvo,
          });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_tipo_atualizacao_registro')
          .setPlaceholder('O que você quer fazer?')
          .addOptions(opcoes);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**📋 Atualizar Registro**\n\nSelecione o que deseja fazer:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith('registro_')) {
        const modal = new ModalBuilder()
          .setCustomId('modal_registro_membro')
          .setTitle('📋 REGISTRO BECKS');

        const nomeInput = new TextInputBuilder()
          .setCustomId('nome_in_game')
          .setLabel('NOME IN-GAME')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Digite o valor do campo 1')
          .setRequired(true);

        const idInput = new TextInputBuilder()
          .setCustomId('id_registro')
          .setLabel('ID')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Digite o valor do campo 2')
          .setRequired(true);

        const telefoneInput = new TextInputBuilder()
          .setCustomId('telefone_registro')
          .setLabel('TELEFONE')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Digite aqui')
          .setRequired(false);

        const recrutadorInput = new TextInputBuilder()
          .setCustomId('recrutador_registro')
          .setLabel('RECRUTADOR(A)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Digite aqui')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nomeInput),
          new ActionRowBuilder().addComponents(idInput),
          new ActionRowBuilder().addComponents(telefoneInput),
          new ActionRowBuilder().addComponents(recrutadorInput)
        );

        await interaction.showModal(modal);
      }
    }
  },
};
