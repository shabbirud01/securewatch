# syntax=docker/dockerfile:1

# ── Stage 1: build ───────────────────────────────────────────────────────────
# Installs every dependency (dev tools included), generates the Prisma client and
# compiles the TypeScript. The `migrate` service in docker-compose.yml runs this stage
# too, because it is the one that contains the Prisma CLI.
FROM node:24-alpine AS build
# Prisma's migration engine needs OpenSSL, which the Alpine image does not include.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# npm ci installs exactly what package-lock.json lists. Its postinstall step runs
# `prisma generate`, which is why the schema is copied first.
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
# Only production dependencies and compiled JavaScript: a smaller image, with no
# compilers or dev tools inside for an attacker to use.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# --omit=optional as well as --omit=dev: the Prisma CLI and TypeScript are dev
# dependencies AND optional peers of @prisma/client, which npm labels "devOptional", and
# --omit=dev alone keeps those (~350 MB). Nothing the server runs needs an optional package.
# --ignore-scripts: our postinstall (prisma generate) needs dev tools, and the client is
# already compiled into dist/.
RUN npm ci --omit=dev --omit=optional --ignore-scripts
COPY --from=build /app/dist ./dist
# Run as the image's unprivileged "node" user instead of root.
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
