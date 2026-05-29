require('dotenv').config({ path: __dirname + '/discord-bot/.env' });
module.exports = {
  apps: [{
    name: 'webxni-agency-heartbeat',
    script: 'scripts/run-agency-heartbeat-daemon.mjs',
    cwd: __dirname,
    interpreter: 'node',
    env: {
      ...process.env,
    },
  }],
};
