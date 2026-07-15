const { EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const deliveryService = require('../services/deliveryService');
const memberService = require('../services/memberService');
const { formatarMoeda, calcularPagamentosPorMembro } = require('../utils/farmPagamentos');

function isMonday() {
  const agora = new Date();
  return agora.getDay() === 1; // 1 = segunda-feira
}

function isMidnight() {
  const agora = new Date();
  return agora.getHours() === 0 && agora.getMinutes() < 1; // Entre 00:00 e 00:01
}

module.exports = {
  initFarmCron(client) {
    let jaExecutouHoje = false;

    // Verificar a cada 1 minuto
    setInterval(async () => {
      // Executar apenas uma vez por dia (segunda-feira às 00:00)
      if (isMonday() && isMidnight()) {
        if (jaExecutouHoje) return;
        jaExecutouHoje = true;

        console.log('🌾 [Farm Cron] Atualizando status de farms...');

        try {
          // Iterar por todos os guilds
          for (const [guildId, guild] of client.guilds.cache) {
            const config = await serverService.getConfig(guildId);

            if (!config.farm) {
              continue;
            }

            // Postar fechamento semanal de pagamentos - independe do resto
            // do farm estar configurado, só precisa do canal de pagamento
            try {
              const canalPagamentoId = config.farm.canal_controle_pagamento_id;
              const canalPagamento = canalPagamentoId ? guild.channels.cache.get(canalPagamentoId) : null;

              if (canalPagamento) {
                const pendentes = calcularPagamentosPorMembro(config, (p) => p.status === 'pendente');

                if (pendentes.length > 0) {
                  const totalGeral = pendentes.reduce((soma, m) => soma + m.total, 0);
                  const lista = pendentes
                    .map((m) => `<@${m.discordId}> — ${formatarMoeda(m.total)} (${m.qtd} pagamento(s))`)
                    .join('\n');

                  const embedFechamento = new EmbedBuilder()
                    .setTitle('🧾 Fechamento Semanal — Pagamentos a Fazer')
                    .setColor(0xf1c40f)
                    .setDescription(`A semana de farm fechou! Total a pagar: **${formatarMoeda(totalGeral)}**\n\n${lista}`)
                    .setFooter({ text: 'Marque como pago aqui no canal conforme for pagando cada um' })
                    .setTimestamp();

                  await canalPagamento.send({ embeds: [embedFechamento] });
                  console.log(`🧾 Fechamento semanal de pagamentos postado (guild ${guildId})`);
                }
              }
            } catch (err) {
              console.error(`Erro ao postar fechamento semanal pra guild ${guildId}:`, err);
            }

          const cargoEmDiaId = config.farm.cargo_em_dia_id;
          const cargoAtrasadoId = config.farm.cargo_atrasado_id;
          const cargoAdv1Id = config.farm.cargo_adv_1;
          const cargoAdv2Id = config.farm.cargo_adv_2;
          const cargoGerenteId = config.cargo_gerente_id;
          const cargoResponsaveisIds = config.farm.cargo_responsaveis_farm || [];

          if (!cargoEmDiaId || !cargoAtrasadoId || !cargoAdv1Id) {
            console.warn('Cargos de farm não configurados corretamente');
            continue;
          }

          // Buscar todos os membros com "Farm em Dia"
          const roleEmDia = guild.roles.cache.get(cargoEmDiaId);
          if (!roleEmDia) {
            console.warn('Cargo Farm em Dia não encontrado');
            continue;
          }

          const membrosComFarmEmDia = await roleEmDia.members;

          for (const [memberId, membro] of membrosComFarmEmDia) {
            try {
              // Verificar se tem cargo de Gerente (exempt de farm delivery)
              const temCargoGerente = cargoGerenteId && membro.roles.cache.has(cargoGerenteId);
              if (temCargoGerente) {
                console.log(`⏭️ ${membro.user.tag}: Gerente - isento de farm delivery`);
                continue;
              }

              // Verificar se há entregas aprovadas na semana passada (consultar DB)
              const agora = new Date();
              const entregas = await deliveryService.getApprovedDeliveries(guildId, membro.id, 7);
              const temEntregaRecente = entregas.length > 0;

              // Se NÃO tem entrega recente, remover Farm em Dia e adicionar atraso
              if (!temEntregaRecente) {
                // Aplicar mudanças de role em paralelo
                await Promise.all([
                  membro.roles.remove(cargoEmDiaId),
                  membro.roles.add(cargoAtrasadoId),
                ]);

                // Contar quantos ADVs já tem
                const temAdv1 = membro.roles.cache.has(cargoAdv1Id);
                const temAdv2 = membro.roles.cache.has(cargoAdv2Id);

                let mensagemADV = '';
                let chegouMaximo = false;

                // Adicionar ADV (respeitando limite de 2)
                if (!temAdv1) {
                  await membro.roles.add(cargoAdv1Id);
                  mensagemADV = '⚠️ Adicionado: ADV Farm 1';
                } else if (!temAdv2) {
                  await membro.roles.add(cargoAdv2Id);
                  mensagemADV = '⚠️ Adicionado: ADV Farm 2';
                } else {
                  // Já tem 2 ADVs, não adiciona mais
                  chegouMaximo = true;
                  mensagemADV = '🚨 LIMITE DE ADVs ATINGIDO (2/2) - SUJEITO A PD';
                }

                console.log(`⚠️ ${membro.user.tag}: Farm atrasou (semana de ${agora.toLocaleDateString('pt-BR')})`);

                // Notificar o usuário
                try {
                  const conteudo = chegouMaximo
                    ? `🚨 Sua meta de farm não foi entregue na semana de ${agora.toLocaleDateString('pt-BR')}!\n\n**Você atingiu o LIMITE de 2 ADVs!**\n\nVocê está **sujeito a PD (Punição da Organização)**.\n\nProcure imediatamente os responsáveis pelo farm para resolver sua situação!`
                    : `⚠️ Sua meta de farm não foi entregue na semana de ${agora.toLocaleDateString('pt-BR')}!\n\n**Cargos atualizados:**\n❌ Removido: Farm em Dia\n✔️ Adicionado: Farm Atrasado\n${mensagemADV}`;

                  await membro.user.send({
                    content: conteudo,
                  });
                } catch (err) {
                  console.warn(`Não foi possível notificar ${membro.user.tag}:`, err.message);
                }

                // Se atingiu máximo de ADVs, notificar responsáveis
                if (chegouMaximo) {
                  for (const cargoId of cargoResponsaveisIds) {
                    const role = guild.roles.cache.get(cargoId);
                    if (role && role.members.size > 0) {
                      console.log(`📢 Notificando responsáveis (${role.name}) sobre ${membro.user.tag}`);
                    }
                  }
                }
              }
            } catch (err) {
              console.error(`Erro ao processar membro ${memberId}:`, err);
            }
          }
          }

          console.log('✅ Cron de farm concluído');
        } catch (err) {
          console.error('❌ Erro no cron de farm:', err);
        }
      } else {
        // Resetar flag se não for mais segunda-feira
        jaExecutouHoje = false;
      }
    }, 60 * 1000); // Verificar a cada 1 minuto

    console.log('🌾 Farm cron job ativado (toda segunda às 00:00)');
  },
};
