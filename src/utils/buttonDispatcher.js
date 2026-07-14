// Dispatcher eficiente que mapeia button/select customId para handlers
// Evita centenas de if statements sequenciais que causam timeout

const buttonDispatcher = new Map();
const selectMenuDispatcher = new Map();

// Registrar um handler de button
function registerButton(customId, handler) {
  buttonDispatcher.set(customId, handler);
}

// Registrar um handler de select menu
function registerSelectMenu(customId, handler) {
  selectMenuDispatcher.set(customId, handler);
}

// Dispatch button com melhor performance
async function dispatchButton(interaction) {
  const handler = buttonDispatcher.get(interaction.customId);
  if (handler) {
    try {
      await handler(interaction);
      return true; // Handler encontrado e executado
    } catch (error) {
      console.error(`Erro ao executar handler para ${interaction.customId}:`, error);
    }
  }
  return false; // Handler não encontrado
}

// Dispatch select menu com melhor performance
async function dispatchSelectMenu(interaction) {
  const handler = selectMenuDispatcher.get(interaction.customId);
  if (handler) {
    try {
      await handler(interaction);
      return true;
    } catch (error) {
      console.error(`Erro ao executar select menu handler para ${interaction.customId}:`, error);
    }
  }
  return false;
}

module.exports = {
  registerButton,
  registerSelectMenu,
  dispatchButton,
  dispatchSelectMenu,
  buttonDispatcher,
  selectMenuDispatcher,
};
