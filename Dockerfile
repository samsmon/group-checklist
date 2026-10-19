# ---- deps ----
FROM oven/bun:1-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- runner ----
FROM oven/bun:1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun src ./src
COPY --chown=bun:bun public ./public
COPY --chown=bun:bun migrations ./migrations
COPY --chown=bun:bun scripts ./scripts

# Run as the unprivileged user shipped with the base image
USER bun

EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
