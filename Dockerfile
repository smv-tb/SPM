# Base image pinned by digest so a rebuild can't silently pick up a different
# image. Bump the tag and digest together (Renovate/Dependabot can do this).
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder
WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.0 --activate

COPY package.json yarn.lock .yarnrc.yml .yarn ./
RUN yarn install --immutable

COPY . .

# Neither `prisma generate` nor `next build` connects to the database, so the
# real DATABASE_URL never enters the build: a build arg or ENV would be stored
# in the image history for anyone who can pull it. The placeholder is scoped
# to this RUN step and is not persisted.
#
# The client must be generated before `next build`: the build type-checks
# every file that imports PrismaClient, and without a generated client
# @prisma/client exports none. (The runner generates its own copy below,
# against its production-only node_modules.)
ARG NEXT_PUBLIC_SUPPORT_EMAIL=
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    sh -c 'node node_modules/prisma/build/index.js generate && yarn build'

# ─── Runner ──────────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner
WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.0 --activate
RUN apk add --no-cache libc6-compat wget

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Next.js 16 standalone output is placed at .next/standalone/<pkg-name>/ by
# `output: "standalone"`. Copy the package directory directly to /app/.
COPY --from=builder /app/.next/standalone /tmp/standalone
COPY --from=builder /app/prisma          /app/prisma
COPY --from=builder /app/prisma.config.mjs /app/prisma.config.mjs
RUN if [ -f /tmp/standalone/server.js ]; then \
      echo 'Standalone: flat structure (server.js at root)'; \
      cp -a /tmp/standalone/* /app/ && cp -a /tmp/standalone/.[!.]* /app/ 2>/dev/null || true; \
    else \
      echo 'Standalone: nested structure (package subdirectory)'; \
      cd /tmp/standalone && PKG_DIR=$(ls -d */ | head -1) && \
      echo "Package dir: $PKG_DIR" && \
      cp -a "$PKG_DIR"/* /app/ && cp -a "$PKG_DIR"/.[!.]* /app/ 2>/dev/null || true; \
    fi && \
    test -f /app/server.js || { echo 'FATAL: server.js missing'; exit 1; } && \
    test -f /app/.next/BUILD_ID || { echo 'FATAL: BUILD_ID missing'; exit 1; } && \
    rm -rf /tmp/standalone

COPY --from=builder /app/.next/static /app/.next/static

# Standalone bundles a traced node_modules from the build platform (Alpine x64
# here, but @prisma/client ships native binaries that vary). Reinstall on the
# runner so platform-specific native modules (Prisma, sharp, etc.) match.
# Production dependencies only: devDependencies (xlsx, Playwright, Vitest…)
# never ship to the server.
RUN rm -rf /app/node_modules

COPY package.json yarn.lock .yarnrc.yml .yarn ./
RUN yarn workspaces focus --all --production && yarn cache clean --all

# Generate the Prisma client here, as root, so the container needs no write
# access to node_modules at runtime.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build node node_modules/prisma/build/index.js generate

RUN rm -f /app/yarn.lock /app/.yarnrc.yml

COPY docker-entrypoint.sh server-wrapper.mjs trusted-proxy.mjs next-esm-loader.mjs register-loader.mjs /app/
RUN chmod +x /app/docker-entrypoint.sh

# Run as the unprivileged `node` user. The code stays root-owned and read-only
# to it; only Next's cache directory is writable.
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache
USER node

EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]