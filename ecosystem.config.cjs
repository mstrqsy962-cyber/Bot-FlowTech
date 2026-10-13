module.exports = {
  apps: [{
    name: 'flowtech-whatsapp',
    script: './src/server.js',
    cwd: __dirname,
    env: { NODE_ENV: 'production' },
    autorestart: true,
    restart_delay: 3000,
    max_memory_restart: '450M'
  }]
};
