const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

// Factory para criar botões comuns
const buttonFactories = {
  // Botões de registro
  pedirRegistro() {
    return new ButtonBuilder()
      .setCustomId('pedir_registro')
      .setLabel('📋 Pedir Registro')
      .setStyle(ButtonStyle.Primary);
  },

  atualizarRegistro() {
    return new ButtonBuilder()
      .setCustomId('atualizar_registro')
      .setLabel('🔄 Atualizar Registro')
      .setStyle(ButtonStyle.Secondary);
  },

  abrirBau() {
    return new ButtonBuilder()
      .setCustomId('abrir_bau')
      .setLabel('📦 Abrir Baú')
      .setStyle(ButtonStyle.Primary);
  },

  registrarADV() {
    return new ButtonBuilder()
      .setCustomId('registrar_adv')
      .setLabel('⚠️ Registrar ADV')
      .setStyle(ButtonStyle.Danger);
  },

  removerADV() {
    return new ButtonBuilder()
      .setCustomId('remover_adv')
      .setLabel('✅ Remover ADV')
      .setStyle(ButtonStyle.Success);
  },

  aprovar() {
    return new ButtonBuilder()
      .setCustomId('aprovar')
      .setLabel('✅ Aprovar')
      .setStyle(ButtonStyle.Success);
  },

  rejeitar() {
    return new ButtonBuilder()
      .setCustomId('rejeitar')
      .setLabel('❌ Rejeitar')
      .setStyle(ButtonStyle.Danger);
  },

  confirmar() {
    return new ButtonBuilder()
      .setLabel('✅ Confirmar')
      .setStyle(ButtonStyle.Success);
  },

  cancelar() {
    return new ButtonBuilder()
      .setLabel('❌ Cancelar')
      .setStyle(ButtonStyle.Danger);
  },
};

// Factory para criar embeds comuns
const embedFactories = {
  // Embed de registro
  registroMenu() {
    return new EmbedBuilder()
      .setTitle('📋 Registro')
      .setColor(0x3498db)
      .setDescription('Clique no botão correspondente:\n\n📋 **Pedir Registro** - Se é sua primeira vez\n🔄 **Atualizar Registro** - Se já foi aprovado anteriormente');
  },

  bauMenu() {
    return new EmbedBuilder()
      .setTitle('📦 Abrir Baú')
      .setColor(0xFFD700)
      .setDescription('Clique no botão para abrir seu baú de farm!\n\nVocê receberá os cargos necessários e terá acesso ao seu canal privado de farm.');
  },

  advMenu() {
    return new EmbedBuilder()
      .setTitle('⚠️ Sistema de ADVs')
      .setColor(0xFF6B6B)
      .setDescription('Use os botões abaixo para registrar ou remover advertências:\n\n**⚠️ Registrar ADV** - Adicionar uma advertência a um membro\n**✅ Remover ADV** - Remover uma advertência de um membro');
  },

  // Embed genérico para aprovação
  approval(titulo, cor, conteudo) {
    return new EmbedBuilder()
      .setTitle(titulo)
      .setColor(cor)
      .setDescription(conteudo);
  },
};

// Factory para criar action rows
const rowFactory = {
  // Row com registro (pedir + atualizar)
  registro() {
    return new ActionRowBuilder().addComponents(
      buttonFactories.pedirRegistro(),
      buttonFactories.atualizarRegistro()
    );
  },

  // Row com baú
  bau() {
    return new ActionRowBuilder().addComponents(
      buttonFactories.abrirBau()
    );
  },

  // Row com ADVs
  advs() {
    return new ActionRowBuilder().addComponents(
      buttonFactories.registrarADV(),
      buttonFactories.removerADV()
    );
  },

  // Row com aprovação/rejeição
  approval() {
    return new ActionRowBuilder().addComponents(
      buttonFactories.aprovar(),
      buttonFactories.rejeitar()
    );
  },

  // Row com confirmação
  confirmation() {
    return new ActionRowBuilder().addComponents(
      buttonFactories.confirmar(),
      buttonFactories.cancelar()
    );
  },
};

module.exports = {
  buttonFactories,
  embedFactories,
  rowFactory,
};
