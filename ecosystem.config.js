module.exports = {
  apps: [
    {
      name: 'inbox',
      cwd: './backend',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
