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

// Export para confirmar que foi carregado
module.exports = {
  loaded: true,
};
