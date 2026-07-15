const { SlashCommandBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const deliveryService = require('../services/deliveryService');

// Comando de manutenção: sincroniza retroativamente o status das entregas já
// aprovadas/rejeitadas (registradas em config.farm.entregas) com a tabela
// relacional entregas_farm no Postgres - necessário porque, até o conserto
// dos botões de aprovar/recusar, essa tabela nunca era atualizada, deixando
// ranking/estatísticas do painel de gerenciamento sempre zerados.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('sincronizar_farm_postgres')
    .setDescription('🔄 [Manutenção] Sincronizar status de entregas antigas com o banco de estatísticas')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);
    const entregas = config.farm?.entregas || [];

    let sincronizadas = 0;
    let jaEstavamOk = 0;
    let falhas = 0;

    for (const entrega of entregas) {
      if (entrega.status !== 'aprovada' && entrega.status !== 'rejeitada') continue;
      if (!entrega.id) continue;

      try {
        const dataEvento = entrega.data_aprovacao
          ? new Date(entrega.data_aprovacao)
          : new Date(entrega.data_entrega);

        const resultado = await deliveryService.sincronizarStatusEntrega(entrega.id, entrega.status, dataEvento, {
          aprovadorId: entrega.aprovador_id || null,
          motivo: entrega.motivo_rejeicao || null,
        });

        if (resultado) {
          sincronizadas++;
        } else {
          jaEstavamOk++;
        }
      } catch (err) {
        console.warn(`Falha ao sincronizar entrega #${entrega.id}:`, err.message);
        falhas++;
      }
    }

    await interaction.editReply({
      content:
        `🔄 **Sincronização concluída!**\n\n` +
        `✅ Entregas corrigidas agora: **${sincronizadas}**\n` +
        `☑️ Já estavam sincronizadas: **${jaEstavamOk}**\n` +
        (falhas > 0 ? `❌ Falhas: **${falhas}**\n` : '') +
        `\nOs relatórios do painel de gerenciamento (Metas, Ranking, etc.) já devem refletir os dados corretos.`,
    });
  },
};
