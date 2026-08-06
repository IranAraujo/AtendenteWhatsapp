module.exports = {
  apps: [
    {
      name: 'atendente-whatsapp-saas',
      script: 'src/server.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    }
  ]
};
