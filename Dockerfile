# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    DATASET_DIR=/app/data \
    WEB_DIR=/app/dist/web \
    DB_PATH=/data/app.db
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# No game data in the image: the dataset is mounted at /app/data (DATASET_DIR), read-only.
RUN mkdir -p /data /app/data && chown node:node /data
USER node
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `docker compose run --rm ficsmap rollback` passes "rollback" as an argument to the server.
ENTRYPOINT ["node", "dist/server/src/server/main.js"]
