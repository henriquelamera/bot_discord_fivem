const { load, save } = require('../store');
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

const CONFIG_FILE = 'config.json';

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
      if (interaction.customId === 'modal_admin_bot') {
        const token = interaction.fields.getTextInputValue('discord_token');
        const clientId = interaction.fields.getTextInputValue('client_id');
        const guildId = interaction.fields.getTextInputValue('guild_id');

        const config = load(CONFIG_FILE, {});
        config.discord_token = token;
        config.client_id = clientId;
        config.guild_id = guildId;
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ Configurações do bot salvas com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_boas_vindas_mensagem') {
        const texto = interaction.fields.getTextInputValue('texto_boas_vindas');
        const banner = interaction.fields.getTextInputValue('banner_url') || '';

        const config = load(CONFIG_FILE, {});
        config.boas_vindas = {
          ...config.boas_vindas,
          texto: texto,
          banner_url: banner,
        };
        save(CONFIG_FILE, config);

        console.log('📝 Boas-vindas configuradas:');
        console.log('   Texto:', texto);
        console.log('   Banner URL:', banner || 'nenhuma');

        await interaction.reply({
          content: '✅ Mensagem e banner configurados com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_registro') {
        const canalSet = interaction.fields.getTextInputValue('canal_set');
        const descricao = interaction.fields.getTextInputValue('descricao_registro') || '';

        const config = load(CONFIG_FILE, {});
        config.registro = {
          canal_id: canalSet,
          descricao: descricao,
        };
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ Configurações de registro salvas com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_notificacoes') {
        const cargoNotificacoes = interaction.fields.getTextInputValue('cargo_notificacoes');

        const config = load(CONFIG_FILE, {});
        config.notificacoes = {
          cargo_id: cargoNotificacoes,
          ativado: true,
        };
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ Notificações configuradas com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_aprovacoes') {
        const cargoAprovacoes = interaction.fields.getTextInputValue('cargo_aprovacoes');

        const config = load(CONFIG_FILE, {});
        config.aprovacoes = {
          cargo_id: cargoAprovacoes,
          ativado: true,
        };
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ Aprovações configuradas com sucesso!',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_entregar_meta') {
        const config = load(CONFIG_FILE, {});
        const itens = config.farm?.itens || [];
        const cargoAprovadoresIds = config.farm?.cargo_pagamento || [];

        if (!cargoAprovadoresIds || cargoAprovadoresIds.length === 0) {
          return await interaction.reply({
            content: '❌ Nenhum cargo de aprovação foi configurado.',
            ephemeral: true,
          });
        }

        try {
          // Coletar dados da entrega
          const entrega = {
            usuario_id: interaction.user.id,
            usuario_tag: interaction.user.tag,
            data_entrega: new Date().toISOString(),
            itens: {},
            print_url: interaction.fields.getTextInputValue('print_comprovacao'),
            status: 'pendente_aprovacao',
          };

          // Preencher items entregues
          for (const item of itens) {
            const quantidade = interaction.fields.getTextInputValue(`item_${item.id}`);
            if (quantidade) {
              entrega.itens[item.id] = {
                nome: item.nome,
                quantidade: parseInt(quantidade),
              };
            }
          }

          // Salvar entrega no config
          if (!config.farm.entregas) config.farm.entregas = [];
          const entrega_id = Date.now().toString();
          entrega.id = entrega_id;
          config.farm.entregas.push(entrega);
          save(CONFIG_FILE, config);

          // Notificar aprovadores
          const canalAprovacaoId = config.farm?.canal_aprovacoes_id;
          const canalAprovacao = canalAprovacaoId
            ? interaction.guild.channels.cache.get(canalAprovacaoId)
            : null;

          if (canalAprovacao) {
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
              .setTitle('📦 Nova Entrega de Farm')
              .setColor(0x3498db)
              .addFields(
                { name: '👤 Usuário', value: interaction.user.tag, inline: true },
                { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true }
              );

            // Adicionar items
            let descricaoItens = '';
            for (const [itemId, dados] of Object.entries(entrega.itens)) {
              descricaoItens += `- **${dados.nome}**: ${dados.quantidade}\n`;
            }
            if (descricaoItens) {
              embed.addFields({ name: '📊 Items', value: descricaoItens });
            }

            embed.addFields({ name: '📸 Print', value: `[Ver imagem](${entrega.print_url})` });

            await canalAprovacao.send({
              embeds: [embed],
              components: [row],
            });
          }

          await interaction.reply({
            content: '✅ Entrega registrada! Aguardando aprovação dos responsáveis.',
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao registrar entrega: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'modal_cadastro_item') {
        const nomesInput = interaction.fields.getTextInputValue('nome_item');
        const descricaoItem = interaction.fields.getTextInputValue('descricao_item') || '';

        const config = load(CONFIG_FILE, {});
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

        save(CONFIG_FILE, config);

        const mensagem = nomes.length === 1
          ? `✅ Item **${nomes[0]}** cadastrado com sucesso!`
          : `✅ **${nomes.length} items** cadastrados com sucesso:\n${nomes.map(n => `- ${n}`).join('\n')}`;

        await interaction.reply({
          content: `${mensagem}\n\nAgora configure as metas e valores para estes items.`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'modal_cadastro_meta') {
        const config = load(CONFIG_FILE, {});
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

        save(CONFIG_FILE, config);

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

      if (interaction.customId === 'modal_atualizar_registro_membro_generico') {
        const nomeInGame = interaction.fields.getTextInputValue('nome_in_game');
        const id = interaction.fields.getTextInputValue('id_registro');
        const atualizarCargo = interaction.fields.getTextInputValue('atualizar_cargo').toLowerCase();
        const solicitadoPor = interaction.fields.getTextInputValue('solicitado_por');
        const userId = interaction.user.id;

        const config = load(CONFIG_FILE, {});

        // Salvar dados temporários da atualização
        if (!config.atualizacoes_pendentes) config.atualizacoes_pendentes = {};
        config.atualizacoes_pendentes[userId] = {
          nomeInGame,
          id,
          solicitadoPor,
          data: new Date().toISOString(),
          atualizarCargo: atualizarCargo === 'sim',
        };
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});

        // Salvar dados temporários da atualização
        if (!config.atualizacoes_pendentes) config.atualizacoes_pendentes = {};
        config.atualizacoes_pendentes[interaction.user.id] = {
          nomeInGame,
          id,
          solicitadoPor,
          data: new Date().toISOString(),
          atualizarCargo: atualizarCargo === 'sim',
        };
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});

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

        save(CONFIG_FILE, config);

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
    }

    if (interaction.isButton()) {
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
              label: 'Canal de Aprovações',
              description: 'Configurar canal onde aparecem as entregas',
              value: 'farm_canal_aprovacoes',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '**🌾 Farm**\n\nSelecione a opção:',
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
              label: 'Cargo Baú Aberto',
              description: 'Cargo dado junto ao Morador',
              value: 'cargo_bau_aberto',
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
        const config = load(CONFIG_FILE, {});
        const token = config.discord_token ? '✅ Configurado' : '❌ Não configurado';
        const clientId = config.client_id ? '✅ Configurado' : '❌ Não configurado';
        const guildId = config.guild_id ? '✅ Configurado' : '❌ Não configurado';
        const cargosQtd = config.cargos_disponiveis ? config.cargos_disponiveis.length : 0;

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

        const cargosMateriais = config.farm?.cargo_materiais?.length > 0
          ? `✅ ${config.farm.cargo_materiais.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ')}`
          : '❌ Não configurado';

        const cargosMetas = config.farm?.cargo_metas?.length > 0
          ? `✅ ${config.farm.cargo_metas.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ')}`
          : '❌ Não configurado';

        const cargosPagamento = config.farm?.cargo_pagamento?.length > 0
          ? `✅ ${config.farm.cargo_pagamento.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ')}`
          : '❌ Não configurado';

        const cargosResponsaveis = config.farm?.cargo_responsaveis_farm?.length > 0
          ? `✅ ${config.farm.cargo_responsaveis_farm.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ')}`
          : '❌ Não configurado';

        const embed = new EmbedBuilder()
          .setTitle('✅ Status do Bot - Admin')
          .setColor(0x2ecc71)
          .addFields(
            { name: '🔐 Discord Token', value: token, inline: true },
            { name: '🆔 Client ID', value: clientId, inline: true },
            { name: '🏢 Guild ID', value: guildId, inline: true },
            { name: '🔴 Cargos Disponíveis', value: `${cargosQtd} cargo(s)`, inline: true },
            { name: '\n🌾 CARGOS DE FARM', value: '---', inline: false },
            { name: '✅ Farm em Dia', value: farmEmDia, inline: true },
            { name: '⏸️ Farm Atrasado', value: farmAtrasado, inline: true },
            { name: '⚠️ ADV Farm 1', value: advFarm1, inline: true },
            { name: '🚨 ADV Farm 2', value: advFarm2, inline: true },
            { name: '\n👥 PERMISSÕES', value: '---', inline: false },
            { name: '📦 Materiais', value: cargosMateriais, inline: false },
            { name: '🎯 Metas', value: cargosMetas, inline: false },
            { name: '💰 Pagamento', value: cargosPagamento, inline: false },
            { name: '👨‍💼 Responsáveis', value: cargosResponsaveis, inline: false }
          );

        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_boas_vindas') {
        const { StringSelectMenuBuilder } = require('discord.js');
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('painel_boas_vindas')
          .setPlaceholder('Escolha uma opção...')
          .addOptions(
            {
              label: 'Configurar',
              description: 'Configurar sistema de boas-vindas',
              value: 'config_boas_vindas',
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({
          content: '**👋 Boas-vindas**\n\nSelecione a opção:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_registro') {
        const { StringSelectMenuBuilder } = require('discord.js');
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
            }
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({
          content: '**📋 Registro**\n\nSelecione a opção:',
          components: [row],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'cat_status') {
        const config = load(CONFIG_FILE, {});

        // Boas-vindas
        const boasVindasCanal = config.boas_vindas?.canal_id
          ? `✅ #${interaction.guild.channels.cache.get(config.boas_vindas.canal_id)?.name || 'ID Inválido'}`
          : '❌ Canal não configurado';
        const boasVindasRegistro = config.boas_vindas?.canal_registro_id
          ? `✅ #${interaction.guild.channels.cache.get(config.boas_vindas.canal_registro_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';
        const boasVindasAprovacoes = config.boas_vindas?.canal_aprovacoes_id
          ? `✅ #${interaction.guild.channels.cache.get(config.boas_vindas.canal_aprovacoes_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';
        const boasVindas = `${boasVindasCanal}\n**📋 Registro:** ${boasVindasRegistro}\n**✅ Aprovações:** ${boasVindasAprovacoes}`;

        // Registro
        const registro = config.registro?.canal_id
          ? `✅ Canal: ${interaction.guild.channels.cache.get(config.registro.canal_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        // Farm - Configurações Gerais
        const farmCategoria = config.farm?.categoria_bau_id
          ? `✅ ${interaction.guild.channels.cache.get(config.farm.categoria_bau_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const farmCanal = config.farm?.canal_aprovacoes_id
          ? `✅ ${interaction.guild.channels.cache.get(config.farm.canal_aprovacoes_id)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        // Farm - Items
        const farmItems = config.farm?.itens?.length > 0
          ? `✅ ${config.farm.itens.length} item(ns) cadastrado(s):\n${config.farm.itens.map(i => `  • ${i.nome}`).join('\n')}`
          : '❌ Nenhum item cadastrado';

        // Farm - Metas
        const farmMetas = config.farm?.metas && Object.keys(config.farm.metas).length > 0
          ? `✅ ${Object.keys(config.farm.metas).length} meta(s) definida(s):\n${Object.values(config.farm.metas).map(m => `  • ${m.nome}: ${m.meta_semanal}/semana`).join('\n')}`
          : '❌ Nenhuma meta definida';

        // Recrutamento
        const recUniforme = config.recrutamento?.rec_canal_uniforme
          ? `✅ ${interaction.guild.channels.cache.get(config.recrutamento.rec_canal_uniforme)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const recRegrasFac = config.recrutamento?.rec_canal_regras_fac
          ? `✅ ${interaction.guild.channels.cache.get(config.recrutamento.rec_canal_regras_fac)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const recRegrasCidade = config.recrutamento?.rec_canal_regras_cidade
          ? `✅ ${interaction.guild.channels.cache.get(config.recrutamento.rec_canal_regras_cidade)?.name || 'ID Inválido'}`
          : '❌ Não configurado';

        const embed = new EmbedBuilder()
          .setTitle('✅ Status das Configurações')
          .setColor(0x2ecc71)
          .addFields(
            { name: '👋 Boas-vindas', value: boasVindas, inline: false },
            { name: '📋 Registro', value: registro, inline: false },
            { name: '\n🌾 FARM', value: '---', inline: false },
            { name: '📁 Categoria de Baús', value: farmCategoria, inline: false },
            { name: '📢 Canal de Aprovações', value: farmCanal, inline: false },
            { name: '📦 Items', value: farmItems, inline: false },
            { name: '🎯 Metas', value: farmMetas, inline: false },
            { name: '\n👥 RECRUTAMENTO', value: '---', inline: false },
            { name: '👕 Uniforme', value: recUniforme, inline: false },
            { name: '📜 Regras da Fac', value: recRegrasFac, inline: false },
            { name: '🏙️ Regras da Cidade', value: recRegrasCidade, inline: false }
          );

        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
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

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(valor === 'cargo_morador' ? 'select_cargo_morador' : 'select_cargo_bau_aberto')
          .setPlaceholder('Selecione o cargo...')
          .addOptions(cargos.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const titulo = valor === 'cargo_morador' ? 'Cargo Morador' : 'Cargo Baú Aberto';

        await interaction.reply({
          content: `**${titulo}**\n\nSelecione qual cargo será atribuído:`,
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

        const config = load(CONFIG_FILE, {});
        if (!config.farm) config.farm = {};

        config.farm[tipo] = cargoIds;
        save(CONFIG_FILE, config);

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
        const config = load(CONFIG_FILE, {});
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
          save(CONFIG_FILE, config);

          await interaction.reply({
            content: `✅ ${titulosCargo[tipo]} configurado!\n**Cargos:** ${cargosNomes}`,
            ephemeral: true,
          });
        } else {
          // Cargos de dia/atrasado/adv são únicos
          const cargoId = interaction.values[0];
          config.farm[`${tipo}_id`] = cargoId;
          save(CONFIG_FILE, config);

          const cargo = interaction.guild.roles.cache.get(cargoId);

          await interaction.reply({
            content: `✅ ${titulosCargo[tipo]} configurado!\n**Cargo:** ${cargo.name}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'select_cargo_morador' || interaction.customId === 'select_cargo_bau_aberto') {
        const cargoId = interaction.values[0];
        const isMorador = interaction.customId === 'select_cargo_morador';

        const config = load(CONFIG_FILE, {});

        if (isMorador) {
          config.cargo_morador_id = cargoId;
        } else {
          config.cargo_bau_aberto_id = cargoId;
        }

        save(CONFIG_FILE, config);

        const cargo = interaction.guild.roles.cache.get(cargoId);
        const titulo = isMorador ? 'Morador' : 'Baú Aberto';

        await interaction.reply({
          content: `✅ Cargo ${titulo} configurado!\n**Cargo:** ${cargo.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_cargos_bot') {
        const cargoIds = interaction.values;

        const config = load(CONFIG_FILE, {});
        config.cargos_disponiveis = cargoIds;
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});
        config.notificacoes = {
          cargo_ids: cargoIds,
          ativado: true,
        };
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});
        config.aprovacoes = {
          cargo_ids: cargoIds,
          ativado: true,
        };
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});
        config.registro = {
          ...config.registro,
          canal_id: canalId,
        };
        save(CONFIG_FILE, config);

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

          const config = load(CONFIG_FILE, {});
          if (!config.farm) config.farm = {};
          config.farm.canal_aprovacoes_id = canalId;
          save(CONFIG_FILE, config);

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
          const config = load(CONFIG_FILE, {});
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
          const config = load(CONFIG_FILE, {});
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
          await interaction.reply({
            content: '🚧 Funcionalidade em desenvolvimento!',
            ephemeral: true,
          });
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
          const config = load(CONFIG_FILE, {});
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

        const config = load(CONFIG_FILE, {});
        if (!config.farm) config.farm = {};
        config.farm.canal_bau_id = canalId;
        save(CONFIG_FILE, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de Abrir Baú configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_categoria_bau_farm') {
        const categoriaId = interaction.values[0];

        const config = load(CONFIG_FILE, {});
        if (!config.farm) config.farm = {};

        config.farm.categoria_bau_id = categoriaId;
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});
        if (!config.farm) config.farm = {};

        if (isBau) {
          config.farm.canal_bau_id = canalId;
        } else {
          config.farm.canal_roupas_id = canalId;
        }

        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});
        if (!config.boas_vindas) config.boas_vindas = {};
        config.boas_vindas.canal_saidas_id = canalId;
        save(CONFIG_FILE, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de Saídas configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_canal_boas_vindas') {
        const canalId = interaction.values[0];

        const config = load(CONFIG_FILE, {});
        config.boas_vindas = {
          ...config.boas_vindas,
          canal_id: canalId,
        };
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});
        if (!config.boas_vindas) config.boas_vindas = {};
        config.boas_vindas.canal_registro_id = canalId;
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});
        if (!config.boas_vindas) config.boas_vindas = {};
        config.boas_vindas.canal_aprovacoes_id = canalId;
        save(CONFIG_FILE, config);

        const canal = interaction.guild.channels.cache.get(canalId);

        await interaction.reply({
          content: `✅ Canal de Aprovações configurado!\n**Canal:** #${canal.name}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'select_cargo_atualizacao') {
        const cargoId = interaction.values[0];
        const userId = interaction.user.id;

        const config = load(CONFIG_FILE, {});
        const atualizacao = config.atualizacoes_pendentes?.[userId];

        if (!atualizacao) {
          return await interaction.reply({
            content: '❌ Dados da atualização não encontrados.',
            ephemeral: true,
          });
        }

        // Salvar cargo selecionado
        atualizacao.novo_cargo_id = cargoId;
        save(CONFIG_FILE, config);

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

        const config = load(CONFIG_FILE, {});
        config.boas_vindas = {
          ...config.boas_vindas,
          cargo_ids: cargoIds,
        };
        save(CONFIG_FILE, config);

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
          const config = load(CONFIG_FILE, {});
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
          const config = load(CONFIG_FILE, {});
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
          const config = load(CONFIG_FILE, {});
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

          const config = load(CONFIG_FILE, {});
          if (!config.recrutamento) config.recrutamento = {};

          config.recrutamento[tipo] = canalId;
          save(CONFIG_FILE, config);

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
        const config = load(CONFIG_FILE, {});
        const morador_role_id = config.cargo_morador_id;

        if (!morador_role_id) {
          return await interaction.reply({
            content: '❌ Cargo "Morador" não foi configurado.',
            ephemeral: true,
          });
        }

        try {
          const membro = await interaction.guild.members.fetch(userId);
          const cargo = interaction.guild.roles.cache.get(morador_role_id);

          if (!cargo) {
            return await interaction.reply({
              content: '❌ Cargo "Morador" não encontrado no servidor.',
              ephemeral: true,
            });
          }

          // Pegar dados do registro
          const registroDados = config.registros_pendentes?.[userId];
          if (registroDados) {
            const nomeFormatado = `${registroDados.nomeInGame} | ${registroDados.id}`;

            // Mudar nickname da pessoa
            await membro.setNickname(nomeFormatado);

            // Salvar dados do membro para usar depois
            if (!config.membros_info) config.membros_info = {};
            config.membros_info[userId] = {
              nomeInGame: registroDados.nomeInGame,
              id: registroDados.id,
              nomeFormatado: nomeFormatado,
              aprovado: true,
            };

            // Remover do registro pendente
            delete config.registros_pendentes[userId];
          }

          await membro.roles.add(cargo);
          save(CONFIG_FILE, config);

          // Enviar mensagem no canal de registro notificando aprovação
          const canalRegistroId = config.boas_vindas?.canal_registro_id;
          const canalBauId = config.farm?.canal_bau_id;

          if (canalRegistroId) {
            const canalRegistro = interaction.guild.channels.cache.get(canalRegistroId);
            if (canalRegistro) {
              let conteudo = `✅ <@${userId}>, seu registro foi **APROVADO**!\n\n`;
              conteudo += `🎯 **Próximo passo:** Clique no botão abaixo para **abrir seu baú de farm**!\n\n`;
              if (canalBauId) {
                conteudo += `📍 Você também pode ir até <#${canalBauId}> para abrir o baú.\n`;
              }

              try {
                const msg = await canalRegistro.send({
                  content: conteudo,
                });

                // Guardar ID da mensagem para deletar depois
                if (!config.membros_info[userId]) config.membros_info[userId] = {};
                config.membros_info[userId].mensagem_aprovacao_id = msg.id;
                save(CONFIG_FILE, config);
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
        const config = load(CONFIG_FILE, {});
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

          save(CONFIG_FILE, config);
          delete config.atualizacoes_pendentes[userId];
          save(CONFIG_FILE, config);

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
        const config = load(CONFIG_FILE, {});

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
          save(CONFIG_FILE, config);
        } catch (err) {
          console.error(err);
          await interaction.reply({
            content: `❌ Erro ao rejeitar: ${err.message}`,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === 'abrir_bau') {
        try {
          const config = load(CONFIG_FILE, {});

          // Validar se está no servidor
          if (!interaction.guild || !interaction.member) {
            return await interaction.reply({
              content: '❌ Você precisa estar no servidor para abrir o baú!',
              ephemeral: true,
            });
          }

          const categoria_bau_id = config.farm?.categoria_bau_id;
          const cargo_bau_aberto_id = config.cargo_bau_aberto_id;
          const cargo_morador_id = config.cargo_morador_id;
          const cargo_farm_em_dia_id = config.farm?.cargo_em_dia_id;
          const rec_uniforme = config.recrutamento?.rec_canal_uniforme;
          const rec_regras_cidade = config.recrutamento?.rec_canal_regras_cidade;

          // Verificar se o registro foi aprovado
          const registroAprovado = config.membros_info?.[interaction.user.id]?.aprovado;
          if (!registroAprovado) {
            return await interaction.reply({
              content: '❌ Seu registro ainda não foi aprovado! Aguarde a análise da administração.',
              ephemeral: true,
            });
          }

          // Verificar se já tem o cargo "Baú Aberto"
          if (cargo_bau_aberto_id && interaction.member.roles.cache.has(cargo_bau_aberto_id)) {
            return await interaction.reply({
              content: '✅ Você já abriu seu baú!',
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
            return await interaction.reply({
              content: '✅ Você já abriu seu baú!',
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
          } catch (err) {
            console.error(`❌ Erro ao gerenciar cargos:`, err.message);
            return await interaction.reply({
              content: `❌ Erro ao gerenciar cargos: ${err.message}`,
              ephemeral: true,
            });
          }

          // Montar mensagem com parabéns, uniformes e regras
          let descricao = `🎉 **PARABÉNS!** Você abriu seu baú de farm!\n\n`;
          if (temCargoVisitante) {
            descricao += `✅ Você agora é um **Morador** oficial da fac!\n\n`;
          }

          if (rec_uniforme || rec_regras_cidade) {
            descricao += `📋 **INFORMAÇÕES IMPORTANTES:**\n`;
            if (rec_uniforme) descricao += `👕 Veja os uniformes em <#${rec_uniforme}>\n`;
            if (rec_regras_cidade) descricao += `🏙️ Leia as regras da cidade em <#${rec_regras_cidade}>\n`;
          }

          const embed = new EmbedBuilder()
            .setTitle('🎉 Bem-vindo(a) ao Baú!')
            .setColor(0xFFD700)
            .setDescription(descricao)
            .setFooter({ text: `Farm de ${interaction.user.username}` })
            .setTimestamp();

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
          if (categoria_bau_id) {
            try {
              const categoria = interaction.guild.channels.cache.get(categoria_bau_id);
              if (categoria && categoria.type === 4) { // GuildCategory
                const nomeFormatado = config.membros_info?.[interaction.user.id]?.nomeFormatado;
                const nomeCanal = (nomeFormatado || interaction.user.username)
                  .toLowerCase()
                  .replace(/[^a-z0-9-|]/g, '-')
                  .replace(/--+/g, '-')
                  .replace(/^-|-$/g, '');

                // Pegar IDs dos responsáveis de farm
                const responsaveisFarmIds = config.farm?.cargo_responsaveis_farm || [];

                // Montar permissões
                const permissoes = [
                  {
                    id: interaction.guild.id, // @everyone
                    deny: ['ViewChannel'],
                  },
                  {
                    id: interaction.user.id, // Apenas a pessoa
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                  },
                ];

                // Adicionar permissões para responsáveis de farm
                for (const roleId of responsaveisFarmIds) {
                  permissoes.push({
                    id: roleId, // Responsáveis de farm
                    allow: ['ViewChannel', 'ReadMessageHistory'],
                  });
                }

                // Criar canal privado
                const canalPessoa = await interaction.guild.channels.create({
                  name: nomeCanal,
                  type: 0, // GuildText
                  parent: categoria_bau_id,
                  permissionOverwrites: permissoes,
                });

                // Enviar mensagem no canal
                const botaoEntregar = new (require('discord.js')).ButtonBuilder()
                  .setCustomId('entregar_meta')
                  .setLabel('📦 Entregar Meta')
                  .setStyle((require('discord.js')).ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(botaoEntregar);

                await canalPessoa.send({
                  embeds: [embed],
                  components: [row],
                });

                console.log(`✅ Canal de farm criado para ${interaction.user.tag}: #${nomeCanal}`);
              }
            } catch (err) {
              console.error(`⚠️ Erro ao criar canal de farm:`, err.message);
            }
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
        const config = load(CONFIG_FILE, {});
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

        // Adicionar campo para upload de print (será um link/URL)
        const printInput = new TextInputBuilder()
          .setCustomId('print_comprovacao')
          .setLabel('Link do Print de Comprovação')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Cole o link da imagem aqui')
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(printInput));

        await interaction.showModal(modal);
      }

      // Handler para botões de aprovação de farm
      if (interaction.customId.startsWith('aprovar_farm_')) {
        const entrega_id = interaction.customId.replace('aprovar_farm_', '');
        const config = load(CONFIG_FILE, {});

        if (!config.farm?.entregas) {
          return await interaction.reply({
            content: '❌ Erro ao buscar entrega.',
            ephemeral: true,
          });
        }

        const entrega = config.farm.entregas.find((e) => e.id === entrega_id);
        if (!entrega) {
          return await interaction.reply({
            content: '❌ Entrega não encontrada.',
            ephemeral: true,
          });
        }

        try {
          const membro = await interaction.guild.members.fetch(entrega.usuario_id);
          const cargoAdv1Id = config.farm?.cargo_adv_1;
          const cargoAdv2Id = config.farm?.cargo_adv_2;
          const cargoAtrasadoId = config.farm?.cargo_atrasado_id;
          const cargoEmDiaId = config.farm?.cargo_em_dia_id;

          // Contar quantos ADVs o membro tem
          const temAdv1 = membro.roles.cache.has(cargoAdv1Id);
          const temAdv2 = membro.roles.cache.has(cargoAdv2Id);
          const totalADVs = (temAdv1 ? 1 : 0) + (temAdv2 ? 1 : 0);

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
          if (temAdv2 && advsRemovidos < advsARemover) {
            await membro.roles.remove(cargoAdv2Id);
            advsRemovidos++;
          }
          if (temAdv1 && advsRemovidos < advsARemover) {
            await membro.roles.remove(cargoAdv1Id);
            advsRemovidos++;
          }

          // Se não tem mais ADVs, remover Farm Atrasado e adicionar Farm em Dia
          const temAdvAgora = membro.roles.cache.has(cargoAdv1Id) || membro.roles.cache.has(cargoAdv2Id);
          if (!temAdvAgora && advsARemover > 0) {
            if (cargoAtrasadoId && membro.roles.cache.has(cargoAtrasadoId)) {
              await membro.roles.remove(cargoAtrasadoId);
            }
            if (cargoEmDiaId) {
              await membro.roles.add(cargoEmDiaId);
            }
          }

          entrega.status = 'aprovada';
          entrega.data_aprovacao = new Date().toISOString();
          entrega.aprovador_id = interaction.user.id;
          save(CONFIG_FILE, config);

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

          await interaction.reply({
            content: mensagemFeedback,
            ephemeral: true,
          });

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
        const config = load(CONFIG_FILE, {});

        if (!config.farm?.entregas) {
          return await interaction.reply({
            content: '❌ Erro ao buscar entrega.',
            ephemeral: true,
          });
        }

        const entrega = config.farm.entregas.find((e) => e.id === entrega_id);
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
          save(CONFIG_FILE, config);

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

      // Handlers de confirmação para metas
      if (interaction.customId === 'confirmar_sobrescrever_meta') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        const config = load(CONFIG_FILE, {});
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
        const config = load(CONFIG_FILE, {});
        config.discord_token = '';
        config.client_id = '';
        config.guild_id = '';
        save(CONFIG_FILE, config);

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
        const config = load(CONFIG_FILE, {});
        config.cargos_disponiveis = [];
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ **Cargos Bot foram deletados!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_admin_cargos_sistema') {
        const config = load(CONFIG_FILE, {});
        config.cargo_morador_id = '';
        config.cargo_bau_aberto_id = '';
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ **Cargos de Sistema foram deletados!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_admin_cargos_farm') {
        const config = load(CONFIG_FILE, {});
        config.farm = {
          itens: [],
          metas: {},
          entregas: [],
        };
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ **Cargos Farm foram completamente deletados!**\n\n⚠️ O sistema de farm precisa ser reconfigurado.',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_bv') {
        const config = load(CONFIG_FILE, {});
        config.boas_vindas = {};
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ **Boas-vindas foram deletadas!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_registro') {
        const config = load(CONFIG_FILE, {});
        config.registro = {};
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ **Registro foi deletado!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_farm_painel') {
        const config = load(CONFIG_FILE, {});
        config.farm = {
          itens: [],
          metas: {},
          entregas: [],
        };
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ **Farm foi deletado!**',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'confirmar_limpar_painel_tudo') {
        const config = load(CONFIG_FILE, {});
        config.boas_vindas = {};
        config.registro = {};
        config.farm = {
          itens: [],
          metas: {},
          entregas: [],
        };
        save(CONFIG_FILE, config);

        await interaction.reply({
          content: '✅ **Tudo foi deletado!**\n\n⚠️ O painel precisa ser completamente reconfigurado.',
          ephemeral: true,
        });
      }

      if (interaction.customId === 'pegar_roupas') {
        const config = load(CONFIG_FILE, {});
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
        const config = load(CONFIG_FILE, {});
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

        // Abrir modal de registro
        const modal = new ModalBuilder()
          .setCustomId('modal_registro_membro')
          .setTitle('📋 REGISTRO BECKS');

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
          new ActionRowBuilder().addComponents(nomeInput),
          new ActionRowBuilder().addComponents(idInput),
          new ActionRowBuilder().addComponents(telefoneInput),
          new ActionRowBuilder().addComponents(recrutadorInput)
        );

        await interaction.showModal(modal);
      }

      if (interaction.customId === 'atualizar_registro') {
        const config = load(CONFIG_FILE, {});
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

        // Verificar se tem registro aprovado
        if (!config.membros_info?.[userId]) {
          return await interaction.reply({
            content: '❌ Você ainda não tem um registro aprovado! Use **Pedir Registro** para se registrar.',
            ephemeral: true,
          });
        }

        // Abrir modal de atualização (simplificado)
        const modal = new ModalBuilder()
          .setCustomId('modal_atualizar_registro_membro_generico')
          .setTitle('📋 ATUALIZAR REGISTRO');

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

        const atualizarCargoInput = new TextInputBuilder()
          .setCustomId('atualizar_cargo')
          .setLabel('Deseja atualizar seu cargo? (sim/não)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Digite: sim ou não')
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
          new ActionRowBuilder().addComponents(atualizarCargoInput),
          new ActionRowBuilder().addComponents(solicitadoInput)
        );

        await interaction.showModal(modal);
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
