// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'skara-bot',
      script: './index.js',
      node_args: '--trace-warnings --trace-uncaught',
      time: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        // DEBUG: 'whatsapp-web.js:*',
        // API_URL: 'https://MakanKecoa-chatbot.hf.space/predict',
        // GEMINI_API_KEY: '...'
      },
      error_file: '~/.pm2/logs/skara-bot-error.log',
      out_file: '~/.pm2/logs/skara-bot-out.log',
      merge_logs: true,
      max_restarts: 10,
      restart_delay: 2000
    }
  ]
}
