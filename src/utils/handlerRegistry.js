// Registro centralizado de handlers para evitar 84+ if statements sequenciais
// Organiza handlers por tipo (modal, button, selectMenu) e padrão de customId

const handlers = {
  modals: new Map(),
  buttons: new Map(),
  selectMenus: new Map(),
  patterns: [], // Para handlers com padrão (wildcard)
};

// Registrar handler de modal
function registerModal(customId, handler) {
  handlers.modals.set(customId, handler);
}

// Registrar handler de botão
function registerButton(customId, handler) {
  handlers.buttons.set(customId, handler);
}

// Registrar handler de select menu
function registerSelectMenu(customId, handler) {
  handlers.selectMenus.set(customId, handler);
}

// Registrar handler com padrão (usar com cuidado, processa por ordem de registro)
function registerPattern(pattern, type, handler) {
  handlers.patterns.push({ pattern, type, handler });
}

// Dispatch modal
async function dispatchModal(interaction) {
  const handler = handlers.modals.get(interaction.customId);
  if (handler) {
    return await handler(interaction);
  }

  // Tentar padrão
  for (const { pattern, type, handler } of handlers.patterns) {
    if (type === 'modal' && pattern.test(interaction.customId)) {
      return await handler(interaction);
    }
  }

  return false;
}

// Dispatch botão
async function dispatchButton(interaction) {
  const handler = handlers.buttons.get(interaction.customId);
  if (handler) {
    return await handler(interaction);
  }

  // Tentar padrão
  for (const { pattern, type, handler } of handlers.patterns) {
    if (type === 'button' && pattern.test(interaction.customId)) {
      return await handler(interaction);
    }
  }

  return false;
}

// Dispatch select menu
async function dispatchSelectMenu(interaction) {
  const handler = handlers.selectMenus.get(interaction.customId);
  if (handler) {
    return await handler(interaction);
  }

  // Tentar padrão
  for (const { pattern, type, handler } of handlers.patterns) {
    if (type === 'selectMenu' && pattern.test(interaction.customId)) {
      return await handler(interaction);
    }
  }

  return false;
}

module.exports = {
  registerModal,
  registerButton,
  registerSelectMenu,
  registerPattern,
  dispatchModal,
  dispatchButton,
  dispatchSelectMenu,
  handlers,
};
