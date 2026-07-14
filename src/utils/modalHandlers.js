const serverService = require('../services/serverService');

// Handlers para modais de validação (senha painel, senha admin_bot)
const validationModalHandlers = {
  async modal_senha_painel(interaction) {
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

      // Enviar para painel de configurações
      await interaction.reply({
        content: 'Login realizado com sucesso! Redirecionando para o painel...',
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Erro: ${err.message}`,
        ephemeral: true,
      });
    }
  },

  async modal_senha_admin_bot(interaction) {
    const senhaInput = interaction.fields.getTextInputValue('senha_admin_bot_input');
    const senhaCorreta = '12345';

    try {
      if (senhaInput !== senhaCorreta) {
        return await interaction.reply({
          content: '❌ Senha de Admin do Bot incorreta!',
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: '✅ Autenticação bem-sucedida! Acesso ao painel de administração concedido.',
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Erro: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

// Dispatcher dispatcher que mapeia customId para handler
const modalDispatcher = {
  async handle(interaction, customId) {
    const handler = validationModalHandlers[customId];
    if (handler) {
      return await handler(interaction);
    }
    return null; // Não é um modal validação
  },
};

module.exports = {
  validationModalHandlers,
  modalDispatcher,
};
