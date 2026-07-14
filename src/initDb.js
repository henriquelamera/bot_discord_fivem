const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function initializeDatabase() {
  try {
    console.log('📊 Inicializando banco de dados...');

    // Ler o arquivo SQL
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    // Executar as queries
    const statements = schema.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await pool.query(statement);
      }
    }

    console.log('✅ Banco de dados inicializado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao inicializar banco de dados:', error.message);
    process.exit(1);
  }
}

module.exports = { initializeDatabase };
