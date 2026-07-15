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

registerModal('modal_configurar_banner_registro', async (interaction) => {
  try {
    const urlInput = interaction.fields.getTextInputValue('banner_registro_url') || '';
    const config = await serverService.getConfig(interaction.guild.id);
    config.boas_vindas = {
      ...(config.boas_vindas || {}),
      banner_url: urlInput,
      imagem_url: urlInput,
    };
    await serverService.saveConfig(interaction.guild.id, config);

    await interaction.reply({
      content: `✅ GIF/Imagem do Registro configurado${urlInput ? '!\n**URL:** ' + urlInput : ' (removido)'}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('Erro ao configurar banner registro:', error);
    await interaction.reply({
      content: `❌ Erro: ${error.message}`,
      ephemeral: true,
    });
  }
});

registerModal('modal_configurar_banner_bau', async (interaction) => {
  try {
    const urlInput = interaction.fields.getTextInputValue('banner_bau_url') || '';
    const config = await serverService.getConfig(interaction.guild.id);
    config.farm = {
      ...(config.farm || {}),
      banner_url: urlInput,
      imagem_url: urlInput,
    };
    await serverService.saveConfig(interaction.guild.id, config);

    await interaction.reply({
      content: `✅ GIF/Imagem do Baú configurado${urlInput ? '!\n**URL:** ' + urlInput : ' (removido)'}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('Erro ao configurar banner bau:', error);
    await interaction.reply({
      content: `❌ Erro: ${error.message}`,
      ephemeral: true,
    });
  }
});

// NOTA: Os handlers de buttons (cat_cargos, cat_farm, etc) estão no código legado
// e têm lógica complexa que funciona bem lá. Apenas os handlers críticos
// (select_canal_* que salvam config) estão registrados aqui.

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
  const banner = interaction.fields.getTextInputValue('banner_url');
  const guildId = interaction.guild.id;

  console.log('🔍 DEBUG Modal Boas-Vindas (Handler Registrado):');
  console.log('   Texto recebido:', texto);
  console.log('   Banner recebido (raw):', banner);
  console.log('   Banner type:', typeof banner);

  try {
    const config = await serverService.getConfig(guildId);
    config.boas_vindas = {
      ...(config.boas_vindas || {}),
      texto: texto,
      banner_url: banner || undefined,
    };
    await serverService.saveConfig(guildId, config);

    console.log('📝 Config salva:', JSON.stringify(config.boas_vindas, null, 2));

    await interaction.reply({
      content: '✅ Mensagem e banner de boas-vindas salvos com sucesso!',
      ephemeral: true,
    });
  } catch (err) {
    console.error('❌ Erro ao salvar:', err);
    await interaction.reply({
      content: `❌ Erro ao salvar: ${err.message}`,
      ephemeral: true,
    });
  }
});

// SELECT MENUS - Apenas os handlers que SALVAM config
// Os que preparam menus (select_categoria_*) estão no código legado
// pois têm lógica complexa que funciona bem lá

// Handlers para salvar canal selecionado
registerSelectMenu('select_canal_boas_vindas', async (interaction) => {
  try {
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
  } catch (error) {
    console.error('Erro ao configurar canal boas-vindas:', error);
    await interaction.reply({
      content: `❌ Erro: ${error.message}`,
      ephemeral: true,
    });
  }
});

registerSelectMenu('select_canal_bv_canal_saidas', async (interaction) => {
  try {
    const canalId = interaction.values[0];
    const config = await serverService.getConfig(interaction.guild.id);
    config.boas_vindas = {
      ...config.boas_vindas,
      canal_saidas_id: canalId,
    };
    await serverService.saveConfig(interaction.guild.id, config);

    const canal = interaction.guild.channels.cache.get(canalId);
    await interaction.reply({
      content: `✅ Canal de Saídas configurado!\n**Canal:** #${canal.name}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('Erro ao configurar canal saídas:', error);
    await interaction.reply({
      content: `❌ Erro: ${error.message}`,
      ephemeral: true,
    });
  }
});

registerSelectMenu('select_canal_farm_canal_bau', async (interaction) => {
  try {
    const canalId = interaction.values[0];
    const config = await serverService.getConfig(interaction.guild.id);
    config.farm = {
      ...config.farm,
      canal_bau_id: canalId,
    };
    await serverService.saveConfig(interaction.guild.id, config);

    const canal = interaction.guild.channels.cache.get(canalId);
    await interaction.reply({
      content: `✅ Canal de Baú configurado!\n**Canal:** #${canal.name}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('Erro ao configurar canal baú:', error);
    await interaction.reply({
      content: `❌ Erro: ${error.message}`,
      ephemeral: true,
    });
  }
});

// Handler para select_cargos_bot (crítico pois salva configuração)
registerSelectMenu('select_cargos_bot', async (interaction) => {
  try {
    const cargoIds = interaction.values;

    const config = await serverService.getConfig(interaction.guild.id);
    config.cargos_disponiveis = cargoIds;
    await serverService.saveConfig(interaction.guild.id, config);

    // Pega nomes dos cargos com segurança (evita null reference)
    const cargosNomes = cargoIds
      .map(id => {
        const role = interaction.guild.roles.cache.get(id);
        return role ? role.name : `[Cargo deletado: ${id}]`;
      })
      .join(', ');

    await interaction.reply({
      content: `✅ Cargos do bot configurados!\n**Cargos selecionados:** ${cargosNomes}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('Erro ao configurar cargos do bot:', error);
    await interaction.reply({
      content: `❌ Erro ao salvar cargos: ${error.message}`,
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
