# syntax=docker/dockerfile:1.7

# --- Stage 1: install + build ---
FROM node:24-alpine AS build
WORKDIR /app

# Native SQLite may need build tooling on Alpine
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: minimal runtime ---
FROM node:24-alpine
WORKDIR /app

# Persistent SQLite volume — mount via Railway/Fly volume at /app/data
RUN mkdir -p /app/data && chown -R node:node /app
ENV QANTARA_DB_PATH=/app/data/qantara.sqlite

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build --chown=node:node /app/dist ./dist

EXPOSE 4000
ENV NODE_ENV=production
ENV PORT=4000

USER node
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
