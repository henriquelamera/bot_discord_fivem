const { initFarmCron } = require('../jobs/farmCron');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Bot online como ${client.user.tag}`);

    if (process.env.FARM_CRON_PAUSADO === 'true') {
      console.log('⏸️ Farm cron job pausado (FARM_CRON_PAUSADO=true)');
    } else {
      initFarmCron(client);
    }
  },
};
