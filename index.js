require('dotenv').config();

// Teste de deploy
require('./src/test-deploy');

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { initializeDatabase } = require('./src/initDb');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
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
})();
