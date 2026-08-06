#!/bin/bash

echo "🚀 Iniciando Deploy do SaaS Atendente & Agendamento WhatsApp IA..."

# 1. Atualiza repositório Git (se aplicável)
if [ -d ".git" ]; then
  echo "📥 Baixando versão mais recente do código..."
  git pull origin main
fi

# 2. Instala dependências de produção
echo "📦 Instalando dependências do projeto..."
npm install --production

# 3. Executa a suíte de testes de validação
echo "🧪 Executando suíte de testes..."
npm test

# 4. Inicia ou reinicia o serviço com PM2
if command -v pm2 &> /dev/null; then
  echo "🔄 Reiniciando processo no PM2..."
  pm2 reload ecosystem.config.cjs || pm2 start ecosystem.config.cjs
  pm2 save
  echo "✅ Aplicação em execução no PM2!"
else
  echo "⚠️ PM2 não encontrado. Execute 'npm install -g pm2' para gerenciar o processo em segundo plano."
  echo "▶️ Para rodar manualmente: npx tsx src/server.ts"
fi

echo "🎉 Deploy concluído com sucesso!"
