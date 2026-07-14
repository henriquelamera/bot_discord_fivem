// Auto-registro de todos os handlers para evitar if/else sequencial
// Este arquivo é importado uma vez ao iniciar o bot

const {
  registerModal,
  registerButton,
  registerSelectMenu,
  registerPattern
} = require('../utils/handlerRegistry');
const serverService = require('../services/serverService');
const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');

// BUTTONS - Categorias de configuração
registerButton('cat_credenciais', async (interaction) => {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('painel_credenciais')
    .setPlaceholder('Escolha uma opção...')
    .addOptions({
      label: 'Configurar',
      description: 'Configurar token, client ID e guild ID',
      value: 'cred_configurar',
    });

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    content: '**🔧 Credenciais**\n\nSelecione a opção:',
    components: [row],
    ephemeral: true,
  });
});

registerButton('cat_cargos', async (interaction) => {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('painel_cargos')
    .setPlaceholder('Escolha uma opção...')
    .addOptions(
      {
        label: 'Morador',
        description: 'Cargo dado ao aprovação',
        value: 'cargo_morador',
      },
      {
        label: 'Membro',
        description: 'Cargo de usuário aprovado',
        value: 'cargo_membro',
      },
      {
        label: 'Gerente',
        description: 'Cargo administrativo',
        value: 'cargo_gerente',
      }
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    content: '**🔴 Cargos do Bot**\n\nSelecione qual cargo deseja configurar:',
    components: [row],
    ephemeral: true,
  });
});

registerButton('cat_recrutamento', async (interaction) => {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('painel_recrutamento')
    .setPlaceholder('Escolha uma opção...')
    .addOptions(
      {
        label: 'Canais',
        description: 'Configurar canais de recrutamento',
        value: 'rec_canais',
      },
      {
        label: 'Cargos',
        description: 'Configurar cargos de recrutamento',
        value: 'rec_cargos',
      }
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    content: '**👥 Recrutamento**\n\nSelecione a opção:',
    components: [row],
    ephemeral: true,
  });
});

registerButton('cat_farm', async (interaction) => {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('painel_farm')
    .setPlaceholder('Escolha uma opção...')
    .addOptions(
      {
        label: 'Canais',
        description: 'Configurar canais de farm',
        value: 'farm_canais',
      },
      {
        label: 'Cargos',
        description: 'Configurar cargos de farm',
        value: 'farm_cargos',
      },
      {
        label: 'Items',
        description: 'Gerenciar items da farm',
        value: 'farm_items',
      },
      {
        label: 'Metas',
        description: 'Configurar metas de farm',
        value: 'farm_metas',
      }
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    content: '**🌾 Farm**\n\nSelecione a opção:',
    components: [row],
    ephemeral: true,
  });
});

registerButton('cat_advs', async (interaction) => {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('painel_advs')
    .setPlaceholder('Escolha uma opção...')
    .addOptions(
      {
        label: 'Canais',
        description: 'Configurar canais de ADV',
        value: 'adv_canais',
      },
      {
        label: 'Cargos',
        description: 'Configurar cargos de ADV',
        value: 'adv_cargos',
      }
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    content: '**⚠️ Sistema de ADVs**\n\nSelecione a opção:',
    components: [row],
    ephemeral: true,
  });
});

registerButton('cat_cargos_farm', async (interaction) => {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('painel_cargos_farm')
    .setPlaceholder('Escolha uma opção...')
    .addOptions(
      {
        label: 'Farm em Dia',
        description: 'Cargo que indica farm atualizado',
        value: 'cargo_farm_em_dia',
      },
      {
        label: 'Farm Atrasado',
        description: 'Cargo que indica farm atrasado',
        value: 'cargo_farm_atrasado',
      },
      {
        label: 'ADV 1',
        description: 'Primeira advertência',
        value: 'cargo_adv_1',
      },
      {
        label: 'ADV 2',
        description: 'Segunda advertência',
        value: 'cargo_adv_2',
      }
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    content: '**🌾 Cargos de Farm**\n\nSelecione qual cargo deseja configurar:',
    components: [row],
    ephemeral: true,
  });
});

registerButton('cat_cargos_sistema', async (interaction) => {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('painel_cargos_sistema')
    .setPlaceholder('Escolha uma opção...')
    .addOptions(
      {
        label: 'Visitante',
        description: 'Cargo padrão ao entrar',
        value: 'cargo_visitante',
      },
      {
        label: 'Morador',
        description: 'Primeiro cargo após aprovação',
        value: 'cargo_morador',
      },
      {
        label: 'Membro',
        description: 'Cargo de membro estabelecido',
        value: 'cargo_membro',
      },
      {
        label: 'Gerente',
        description: 'Cargo administrativo',
        value: 'cargo_gerente',
      }
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await interaction.reply({
    content: '**⭐ Cargos Sistema**\n\nSelecione qual cargo deseja configurar:',
    components: [row],
    ephemeral: true,
  });
});

// MODALS - Handlers principais
registerModal('modal_admin_bot', async (interaction) => {
  const token = interaction.fields.getTextInputValue('discord_token');
  const clientId = interaction.fields.getTextInputValue('client_id');
  const guildId = interaction.fields.getTextInputValue('guild_id');

  const config = await serverService.getConfig(interaction.guild.id);
  config.discord_token = token;
  config.client_id = clientId;
  config.guild_id = guildId;
  await serverService.saveConfig(interaction.guild.id, config);

  await interaction.reply({
    content: '✅ Credenciais do bot salvas com sucesso!',
    ephemeral: true,
  });
});

registerModal('modal_boas_vindas_mensagem', async (interaction) => {
  const texto = interaction.fields.getTextInputValue('texto_boas_vindas');
  const guildId = interaction.guild.id;

  try {
    const config = await serverService.getConfig(guildId);
    config.boas_vindas = {
      ...(config.boas_vindas || {}),
      mensagem_padrao: texto,
    };
    await serverService.saveConfig(guildId, config);

    await interaction.reply({
      content: '✅ Mensagem de boas-vindas salva com sucesso!',
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({
      content: `❌ Erro ao salvar: ${err.message}`,
      ephemeral: true,
    });
  }
});

// Padrões para handlers que seguem nome comum
registerPattern(/^select_.*/, 'selectMenu', async (interaction) => {
  // Fallback para select menus genéricos - será tratado por fallthrough
  return false;
});

// Export para confirmar que foi carregado
module.exports = {
  loaded: true,
};
