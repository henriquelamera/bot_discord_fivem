const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const serverService = require('../services/serverService');
const { publishMessage } = require('../utils/publishMessages');
const { rowFactory } = require('../utils/componentFactory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publicar_registro')
    .setDescription('📋 Publicar botões de Registro no canal configurado')
    .setDefaultMemberPermissions(0x8), // ADMINISTRATOR

  async execute(interaction) {
    // Avisar ao Discord que vai processar (evita timeout)
    await interaction.deferReply({ ephemeral: true });

    const config = await serverService.getConfig(interaction.guild.id);
    const canalRegistroId = config.boas_vindas?.canal_registro_id;

    // DEBUG
    console.log('📋 Config Boas-Vindas:', JSON.stringify(config.boas_vindas, null, 2));

    // Criar embed com imagem/GIF se configurado
    const embed = new EmbedBuilder()
      .setTitle('📋 Registro')
      .setColor(0x3498db)
      .setDescription('Clique no botão correspondente:\n\n📋 **Pedir Registro** - Se é sua primeira vez\n🔄 **Atualizar Registro** - Se já foi aprovado anteriormente');

    // Adicionar imagem/GIF se existir na config
    if (config.boas_vindas?.imagem_url || config.boas_vindas?.banner_url) {
      const imageUrl = config.boas_vindas.imagem_url || config.boas_vindas.banner_url;
      console.log('✅ Adicionando imagem:', imageUrl);
      embed.setImage(imageUrl);
    } else {
      console.log('❌ Nenhuma imagem configurada');
      console.log('   imagem_url:', config.boas_vindas?.imagem_url);
      console.log('   banner_url:', config.boas_vindas?.banner_url);
    }

    const row = rowFactory.registro();

    // Validar canal
    if (!canalRegistroId) {
      return await interaction.editReply({
        content: '❌ Canal de Registro não foi configurado!',
      });
    }

    const canal = interaction.guild.channels.cache.get(canalRegistroId);
    if (!canal) {
      return await interaction.editReply({
        content: '❌ Canal de Registro não encontrado!',
      });
    }

    try {
      await canal.send({
        embeds: [embed],
        components: [row],
      });

      await interaction.editReply({
        content: `✅ Botões publicados em <#${canalRegistroId}>!`,
      });
    } catch (err) {
      await interaction.editReply({
        content: `❌ Erro ao publicar: ${err.message}`,
      });
    }
  },
};
