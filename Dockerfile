FROM node:20-alpine

WORKDIR /app

# Instala dependências do sistema (incluindo openssl para o Prisma no Alpine)
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npx prisma generate && npm run build

EXPOSE 10000

ENV PORT=10000
ENV NODE_ENV=production

CMD ["npm", "start"]
