# syntax=docker/dockerfile:1.7

FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY index.js ./index.js

EXPOSE 8081
ENV NODE_ENV=production
ENV BOT_WEBHOOK_PORT=8081

USER node

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const port=Number(process.env.BOT_WEBHOOK_PORT||0); if(!port) process.exit(0); fetch('http://127.0.0.1:'+port+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
