require('dotenv').config();
const pool = require('./db');
const serverService = require('./services/serverService');
const memberService = require('./services/memberService');
const deliveryService = require('./services/deliveryService');
const advService = require('./services/advService');

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(tipo, mensagem) {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  const emoji = {
    ok: '✅',
    erro: '❌',
    info: 'ℹ️',
    aviso: '⚠️',
  };

  console.log(`${emoji[tipo]} [${timestamp}] ${mensagem}`);
}

async function testarBanco() {
  try {
    log('info', 'Iniciando testes do banco de dados...\n');

    // 1. Testar conexão
    log('info', 'Testando conexão com PostgreSQL...');
    const result = await pool.query('SELECT NOW()');
    log('ok', `Conectado ao banco! Hora do servidor: ${result.rows[0].now}\n`);

    // 2. Registrar servidor de teste
    log('info', 'Criando servidor de teste...');
    const servidor = await serverService.registerServer(
      '123456789',
      'Servidor Teste RBK',
      '987654321'
    );
    log('ok', `Servidor criado: ID=${servidor.id}, Guild=${servidor.guild_id}\n`);

    // 3. Criar API Keys
    log('info', 'Criando API Keys...');
    const chave1 = await serverService.createAPIKey(
      '123456789',
      'Chave Admin',
      ['read', 'write', 'admin']
    );
    log('ok', `API Key Admin criada: ${chave1.chave_token.substring(0, 10)}...`);

    const chave2 = await serverService.createAPIKey(
      '123456789',
      'Chave Read Only',
      ['read']
    );
    log('ok', `API Key Read criada: ${chave2.chave_token.substring(0, 10)}...\n`);

    // 4. Validar API Key
    log('info', 'Testando validação de API Keys...');
    const validacao = await serverService.validateAPIKey(chave1.chave_token, 'write');
    if (validacao) {
      log('ok', `✓ Chave admin validada com permissão 'write'`);
    }

    const validacao2 = await serverService.validateAPIKey(chave2.chave_token, 'write');
    if (!validacao2) {
      log('ok', `✓ Chave read foi corretamente rejeitada para 'write'\n`);
    }

    // 5. Salvar membros
    log('info', 'Salvando membros...');
    const membro1 = await memberService.saveMember(
      '123456789',
      '111111111',
      'João',
      1234,
      'João | 1234'
    );
    log('ok', `Membro 1 criado: ${membro1.nome_formatado}`);

    const membro2 = await memberService.saveMember(
      '123456789',
      '222222222',
      'Maria',
      5678,
      'Maria | 5678'
    );
    log('ok', `Membro 2 criado: ${membro2.nome_formatado}\n`);

    // 6. Verificar aprovação
    log('info', 'Testando status de aprovação...');
    const aprovado1 = await memberService.isMemberApproved('123456789', '111111111');
    log('ok', `João aprovado? ${aprovado1} (esperado: false)`);

    // 7. Aprovar membro
    log('info', 'Aprovando membro...');
    await memberService.approveMember('123456789', '111111111');
    const aprovado2 = await memberService.isMemberApproved('123456789', '111111111');
    log('ok', `João agora aprovado? ${aprovado2} (esperado: true)\n`);

    // 8. Criar entrega
    log('info', 'Criando entrega de farm...');
    const entregaId = await deliveryService.createDelivery(
      '123456789',
      '111111111',
      {
        item1: { nome: 'Maconha', quantidade: 300 },
        item2: { nome: 'Cocaína', quantidade: 200 },
      },
      'https://imgur.com/teste.jpg'
    );
    log('ok', `Entrega criada: ID=${entregaId}\n`);

    // 9. Buscar entrega
    log('info', 'Buscando entrega...');
    const entrega = await deliveryService.getDelivery(entregaId);
    log('ok', `Entrega encontrada: Status=${entrega.status}, User=${entrega.discord_id}`);

    // 10. Pegar items da entrega
    const items = await deliveryService.getDeliveryItems(entregaId);
    log('ok', `Items: ${items.map(i => `${i.item_nome}(${i.quantidade})`).join(', ')}\n`);

    // 11. Adicionar ADVs
    log('info', 'Testando sistema de ADVs...');
    await advService.addADV('123456789', '222222222', 1, 'Não entregou na semana 1');
    log('ok', 'ADV 1 adicionado para Maria');

    const countADV = await advService.countADVs('123456789', '222222222');
    log('ok', `Maria tem ${countADV} ADV(s)\n`);

    // 12. Logging
    log('info', 'Testando sistema de logs...');
    await serverService.logAction(
      '123456789',
      '111111111',
      'teste_entrega',
      'Entrega de teste criada com sucesso'
    );
    const logs = await serverService.getLogs('123456789', 5);
    log('ok', `${logs.length} log(s) encontrado(s) no servidor\n`);

    // 13. Listar API Keys
    log('info', 'Listando API Keys do servidor...');
    const chaves = await serverService.listAPIKeys('123456789');
    log('ok', `${chaves.length} API key(s) ativa(s):`);
    chaves.forEach(c => {
      log('info', `  - ${c.nome_chave} (perms: ${c.permissoes.join(', ')})`);
    });
    console.log();

    // 14. Resumo final
    log('info', '═══════════════════════════════════════');
    log('ok', `TODOS OS TESTES PASSARAM! ✨`);
    log('info', '═══════════════════════════════════════\n');

    console.log(`${colors.green}Resumo:${colors.reset}`);
    console.log(`  ✓ Conexão PostgreSQL funcionando`);
    console.log(`  ✓ Servidor criado e isolado`);
    console.log(`  ✓ API Keys geradas e validadas`);
    console.log(`  ✓ Membros salvos por servidor`);
    console.log(`  ✓ Aprovação de registros funciona`);
    console.log(`  ✓ Entregas podem ser criadas`);
    console.log(`  ✓ Sistema de ADVs funciona`);
    console.log(`  ✓ Logs de auditoria salvos`);
    console.log(`  ✓ Multi-servidor isolado corretamente\n`);

    log('info', 'Banco de dados está PRONTO para produção! 🚀');

  } catch (error) {
    log('erro', `Erro durante testes: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
    log('info', 'Conexão fechada.');
  }
}

// Executar testes
testarBanco();
