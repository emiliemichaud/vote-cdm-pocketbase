module.exports = {
  apps: [
    {
      name: 'vote-cdm',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
