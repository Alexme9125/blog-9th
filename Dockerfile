# syntax=docker/dockerfile:1.7

FROM node:24.21.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# The migrator needs Drizzle and postgres at runtime, but does not need tsx,
# embedded-postgres, or any other development dependency.  Keep this before
# the application builder so legacy Docker builders can build migration targets
# without executing the application build stage.
FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# This target is only used by the one-shot migration job in compose.yaml. It
# uses Node 24's native TypeScript stripping and production dependencies only.
FROM node:24.21.0-bookworm-slim AS migrator

ENV NODE_ENV=production

WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./package.json
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY drizzle ./drizzle

USER node

CMD ["node", "--experimental-strip-types", "scripts/migrate.ts"]

# Bootstrap uses only the same production dependency set. Its schema module
# has no runtime tsconfig-path alias imports, so Node can execute it directly.
# Demo seeding intentionally stays outside this target because it needs the
# complete Next/TypeScript runtime.
FROM migrator AS bootstrap

COPY scripts/bootstrap.ts ./scripts/bootstrap.ts
COPY src/lib/db/schema.ts ./src/lib/db/schema.ts
COPY src/lib/db/mail-schema.ts src/lib/db/community-schema.ts ./src/lib/db/

CMD ["node", "--experimental-strip-types", "scripts/bootstrap.ts"]

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Next.js needs this stable key while compiling Server Functions. A BuildKit
# secret avoids recording the supplied value as a Docker ARG or ENV layer.
RUN --mount=type=secret,id=next_server_actions_encryption_key,required=true \
  export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat /run/secrets/next_server_actions_encryption_key)" \
  && test -n "$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" \
  && pnpm build

FROM node:24.21.0-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /app/data/media \
  && chown -R nextjs:nodejs /app/data

# Next.js standalone output contains only files traced for runtime. Public
# assets and .next/static are copied explicitly, per the Next.js standalone
# deployment contract.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
