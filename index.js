require('dotenv').config();

// Teste de deploy
require('./src/test-deploy');

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { initializeDatabase } = require('./src/initDb');
const { iniciarServidorWeb } = require('./src/web/server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Rede de segurança global: sem isso, QUALQUER erro não tratado em qualquer
// handler de interação (ex: responder uma interação que já expirou, uma
// permissão de cargo com nome errado, um import faltando) derruba o
// processo inteiro e desconecta todo mundo, não só quem causou o erro. Só
// loga e segue - erros individuais continuam devendo ser corrigidos na
// origem, isso aqui é só pra não deixar um bug pequeno virar uma queda
// geral do bot.
client.on('error', (err) => {
  console.error('❌ Erro não tratado no Client do Discord:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Promise rejeitada sem tratamento:', err);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Exceção não capturada:', err);
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'src', 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

const eventsPath = path.join(__dirname, 'src', 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

// Registrar slash commands no Discord (necessário sempre que um comando é
// adicionado/alterado, senão ele nunca aparece na lista do Discord)
async function registrarComandos() {
  const commandsData = [...client.commands.values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commandsData },
  );
  console.log(`✅ ${commandsData.length} comando(s) registrado(s) no Discord.`);
}

// Inicializar banco de dados antes de fazer login
(async () => {
  await initializeDatabase();
  await client.login(process.env.DISCORD_TOKEN);

  try {
    await registrarComandos();
  } catch (err) {
    console.error('❌ Erro ao registrar comandos:', err.message);
  }

  iniciarServidorWeb(client);
})();
