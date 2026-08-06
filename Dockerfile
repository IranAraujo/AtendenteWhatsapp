FROM node:18-alpine

WORKDIR /app

# Copia manifestos e instala dependências
COPY package*.json ./
RUN npm ci --only=production

# Copia código fonte e arquivos estáticos
COPY . .

EXPOSE 3001

CMD ["npx", "tsx", "src/server.ts"]
