const pool = require('../db');

// Registrar uma venda confirmada pela calculadora web
async function registrarVenda(guildId, dados) {
  try {
    const servidorResult = await pool.query(
      'SELECT id FROM servidores WHERE guild_id = $1',
      [guildId]
    );
    if (servidorResult.rows.length === 0) throw new Error('Servidor não encontrado');
    const servidorId = servidorResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO vendas_registradas (
         servidor_id, produto_id, produto_nome, tipo, quantidade,
         preco_unitario, valor_total, parceria_id, faccao_nome, registrado_por,
         registrado_por_discord_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        servidorId,
        dados.produtoId,
        dados.produtoNome,
        dados.tipo,
        dados.quantidade,
        dados.precoUnitario,
        dados.valorTotal,
        dados.parceriaId || null,
        dados.faccaoNome || null,
        dados.registradoPor || null,
        dados.registradoPorDiscordId || null,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao registrar venda:', error);
    throw error;
  }
}

// Uma parceria por facção (a mais recente) - usado pra popular o seletor da
// venda com parceria. O id da parceria vira o valor interno do select
// (satisfaz "identificador da parceria como valor interno"), o nome da
// facção é só o texto mostrado. DISTINCT ON evita mostrar a mesma facção
// repetida quando ela tem várias parcerias registradas (produtos diferentes).
async function listarFaccoesParceria(guildId) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (p.nome_faccao) p.id, p.nome_faccao
       FROM parcerias p
       JOIN servidores s ON p.servidor_id = s.id
       WHERE s.guild_id = $1
       ORDER BY p.nome_faccao ASC, p.data_registro DESC`,
      [guildId]
    );
    return result.rows.map((r) => ({ id: r.id, nome: r.nome_faccao }));
  } catch (error) {
    console.error('Erro ao listar facções de parceria:', error);
    throw error;
  }
}

// Resolve o nome da facção a partir do id de uma parceria - usado pro
// backend nunca confiar no nome enviado pelo cliente quando uma parceria
// específica foi selecionada (só confia no texto livre da venda "pista")
async function getNomeFaccaoPorParceriaId(guildId, parceriaId) {
  try {
    const result = await pool.query(
      `SELECT p.nome_faccao FROM parcerias p
       JOIN servidores s ON p.servidor_id = s.id
       WHERE s.guild_id = $1 AND p.id = $2`,
      [guildId, parceriaId]
    );
    return result.rows[0]?.nome_faccao || null;
  } catch (error) {
    console.error('Erro ao resolver nome da facção:', error);
    throw error;
  }
}

// Listar vendas registradas de um servidor (mais recentes primeiro)
async function listarVendas(guildId, limit = 100) {
  try {
    const result = await pool.query(
      `SELECT v.* FROM vendas_registradas v
       JOIN servidores s ON v.servidor_id = s.id
       WHERE s.guild_id = $1
       ORDER BY v.data_registro DESC
       LIMIT $2`,
      [guildId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao listar vendas:', error);
    throw error;
  }
}

// Registra uma venda com um ou mais produtos de uma vez. Cada produto vira
// uma linha em vendas_registradas, todas com o mesmo venda_grupo_id (é isso
// que o relatório usa pra mostrar "Venda #N" agrupando as linhas). Roda em
// transação: ou entra tudo ou nada.
async function registrarVendasEmGrupo(guildId, comum, itens) {
  const client = await pool.connect();
  try {
    const servidorResult = await client.query('SELECT id FROM servidores WHERE guild_id = $1', [guildId]);
    if (servidorResult.rows.length === 0) throw new Error('Servidor não encontrado');
    const servidorId = servidorResult.rows[0].id;

    await client.query('BEGIN');
    const linhas = [];
    for (const it of itens) {
      const r = await client.query(
        `INSERT INTO vendas_registradas (
           servidor_id, produto_id, produto_nome, tipo, quantidade,
           preco_unitario, valor_total, parceria_id, faccao_nome, registrado_por,
           registrado_por_discord_id, venda_grupo_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          servidorId, it.produtoId, it.produtoNome, comum.tipo, it.quantidade,
          it.precoUnitario, it.valorTotal, comum.parceriaId || null, comum.faccaoNome || null,
          comum.registradoPor || null, comum.registradoPorDiscordId || null, comum.vendaGrupoId,
        ]
      );
      linhas.push(r.rows[0]);
    }
    await client.query('COMMIT');
    return linhas;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao registrar venda em grupo:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Lista as vendas registradas num intervalo de datas (inclusive, dias no
// horário de Brasília). data_registro é TIMESTAMP sem fuso gravado com
// NOW() no Railway (UTC) - o Brasil é UTC-3 fixo, então basta subtrair 3h
// pra virar horário de parede local antes de comparar/exibir. Mais antiga
// primeiro, pra relatório/CSV saírem em ordem cronológica.
async function listarVendasPorPeriodo(guildId, dataInicio, dataFim) {
  try {
    const result = await pool.query(
      `SELECT v.id, v.produto_nome, v.tipo, v.quantidade, v.preco_unitario, v.valor_total,
              v.faccao_nome, v.registrado_por, v.registrado_por_discord_id, v.venda_grupo_id,
              to_char(v.data_registro - interval '3 hours', 'YYYY-MM-DD') AS data_local,
              to_char(v.data_registro - interval '3 hours', 'HH24:MI') AS hora_local
       FROM vendas_registradas v
       JOIN servidores s ON v.servidor_id = s.id
       WHERE s.guild_id = $1
         AND (v.data_registro - interval '3 hours')::date BETWEEN $2::date AND $3::date
       ORDER BY v.data_registro ASC, v.id ASC`,
      [guildId, dataInicio, dataFim]
    );
    return result.rows.map((r) => ({
      id: r.id,
      data: r.data_local,
      hora: r.hora_local,
      produto: r.produto_nome,
      tipo: r.tipo,
      quantidade: Number(r.quantidade),
      precoUnitario: Number(r.preco_unitario),
      valorTotal: Number(r.valor_total),
      faccao: r.faccao_nome || null,
      vendedor: r.registrado_por || null,
      vendedorId: r.registrado_por_discord_id || null,
      grupo: r.venda_grupo_id || ('legado_' + r.id),
    }));
  } catch (error) {
    console.error('Erro ao listar vendas por período:', error);
    throw error;
  }
}

module.exports = { registrarVenda, registrarVendasEmGrupo, listarFaccoesParceria, getNomeFaccaoPorParceriaId, listarVendas, listarVendasPorPeriodo };
