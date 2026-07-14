require('dotenv').config();
const { initializeDatabase } = require('./initDb');

initializeDatabase().then(() => {
  console.log('✅ Banco inicializado com sucesso!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
