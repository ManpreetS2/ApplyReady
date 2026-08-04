# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages

RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    PUBLIC_DEMO_MODE=true \
    PUBLIC_DEMO_TTL_HOURS=6 \
    APPLYREADY_DATA_DIR=/tmp/applyready-data \
    APPLYREADY_UPLOADS_DIR=/tmp/applyready-uploads \
    APPLYREADY_DB_PATH=/tmp/applyready-data/applyready.sqlite \
    APPLYREADY_CLIENT_DIST=/app/packages/client/dist

RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system applyready \
  && useradd --system --gid applyready --home-dir /home/applyready --create-home applyready \
  && mkdir -p \
    /tmp/applyready-data \
    /tmp/applyready-uploads \
    /tmp/applyready-uploads/applications \
    /tmp/applyready-uploads/vault \
    /tmp/applyready-uploads/sources \
  && chown -R applyready:applyready /tmp/applyready-data /tmp/applyready-uploads /home/applyready

COPY --from=build --chown=applyready:applyready /app/package.json /app/package-lock.json ./
COPY --from=build --chown=applyready:applyready /app/node_modules ./node_modules
COPY --from=build --chown=applyready:applyready /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=applyready:applyready /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=applyready:applyready /app/packages/server/package.json ./packages/server/package.json
COPY --from=build --chown=applyready:applyready /app/packages/server/dist ./packages/server/dist
COPY --from=build --chown=applyready:applyready /app/packages/client/package.json ./packages/client/package.json
COPY --from=build --chown=applyready:applyready /app/packages/client/dist ./packages/client/dist

USER applyready
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# dumb-init forwards signals so Node can shut down gracefully.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/server/dist/index.js"]
