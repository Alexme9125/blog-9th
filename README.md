# Darwin Journal

Darwin Journal is a Next.js application with PostgreSQL, Drizzle, Better Auth,
and a persistent media volume. The production stack uses Node 24 LTS,
PostgreSQL 17, and Caddy.

## Release branches

| Branch | Default homepage |
| --- | --- |
| `main` | Classic, non-anniversary edition |
| `9th-Anniversary` | Four-scene ninth anniversary edition |

Both branches include the same CMS, authentication, deployment fixes and both
visual implementations. `SITE_EDITION` explicitly overrides the branch default.
When switching an existing deployment to another branch, update that value in
its private `.env` too; an existing environment value takes precedence.

Clone the desired branch:

```bash
git clone --branch main https://github.com/Alexme9125/blog-9th.git
# Or: git clone --branch 9th-Anniversary https://github.com/Alexme9125/blog-9th.git
```

See [release validation](docs/release-validation.md) for the production checks,
and [domain/deployment setup](docs/域名配置与部署.md) for a fresh server.

中文文档：[使用指南](docs/使用指南.md) · [域名配置与部署](docs/域名配置与部署.md) · [功能验证](docs/qa/validation.md) · [视觉验收](docs/qa/visual-acceptance.md) · [存储验收](docs/qa/storage-validation.md)

## Email and community pages

Both editions include administrator-configured SMTP, confirmed email subscriptions,
automatic and manual article delivery, and verified join applications with emailed
copies. SMTP is disabled until configured. A PostgreSQL outbox retains pending work
across app restarts; the Node server drains it with bounded retries. Configure and
inspect mail delivery at `/admin/mail`, manage subscribers/applications at
`/admin/community`, and edit `/privacy` and `/about` at `/admin/special-pages`.

This release adds database migrations. Apply them before starting the updated app;
see [SMTP setup and upgrade](docs/SMTP配置.md). Back up both the database and the
stable encryption/authentication secret: the SMTP password is encrypted at rest.

## Local development

Install dependencies and generate the remaining local-only auth configuration
once. This command preserves any existing values and never prints the
generated secret:

```bash
pnpm install
pnpm rebuild @embedded-postgres/darwin-arm64
node <<'NODE'
const { randomBytes } = require('node:crypto');
const { appendFileSync, existsSync, readFileSync, chmodSync } = require('node:fs');
const file = '.env.local';
const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
const entries = [];
if (!/^BETTER_AUTH_SECRET=/m.test(current)) {
  entries.push('BETTER_AUTH_SECRET=' + randomBytes(32).toString('base64url'));
}
if (!/^BETTER_AUTH_URL=/m.test(current)) {
  entries.push('BETTER_AUTH_URL=http://127.0.0.1:3000');
}
if (!/^SITE_URL=/m.test(current)) entries.push('SITE_URL=http://127.0.0.1:3000');
if (entries.length) {
  appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') +
    entries.join('\n') + '\n', { mode: 0o600 });
}
chmodSync(file, 0o600);
NODE
```

Start the development environment with one command:

```bash
pnpm dev
```

`pnpm dev` waits for PostgreSQL to accept SQL connections before starting
Next.js. With no `DATABASE_URL`, it creates the ignored `.env.local` entry and
starts the project-local database at `127.0.0.1:55432` with the `darwin`
database and user. For that exact local URL, it starts or initializes the
`.data/postgres` cluster when needed or reuses an already-running instance.
For every other PostgreSQL URL, it leaves the configured database and
environment file untouched, waits for that database instead, and does not
create a local cluster.

Leave the first `pnpm dev` running while completing the one-time schema and
administrator setup in a second terminal:

```bash
pnpm db:migrate
pnpm db:bootstrap
```

After setup, use `pnpm dev` for normal local work. It stops only the database
process it started when Next.js exits or receives Ctrl+C; a reused local or
external database remains running. If the configured database stops while the
development server is running, the launcher stops Next.js and exits with an
error instead of leaving a broken site running.

`pnpm dev:web` remains available when a database is already managed elsewhere
and only a standalone Next.js development server is wanted. `pnpm db:start`
is also retained for direct database troubleshooting.

`embedded-postgres` is only a local-development dependency. It is not part of
the production application image.

`pnpm db:bootstrap` creates or updates the initial administrator through
prompts or `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD`. It must run after
the migrations and before the first normal application startup. The database
commands keep secrets in `.env.local` and never print the connection URL:

Demo seeding is explicitly local-development work and needs the complete
TypeScript/Next source runtime:

```bash
pnpm db:bootstrap:demo
```

## Production deployment

1. Install Docker Engine, the Buildx plugin / BuildKit, and Docker Compose v2 on the server.
2. Copy `.env.example` to `.env` and replace every placeholder. `DATABASE_URL`
   must use the same PostgreSQL password as `POSTGRES_PASSWORD` and hostname
   `db`; if that password contains URL-reserved characters, percent-encode its
   password component in `DATABASE_URL` (or generate a URL-safe password).
   Keep `SITE_URL` and `BETTER_AUTH_URL` consistent. The authentication
   client always uses the current same-origin URL, so it needs no build-time
   `NEXT_PUBLIC_BETTER_AUTH_URL` configuration. Keep
   `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` stable. Compose passes it to the
   Next.js build through a one-time BuildKit secret mount and supplies it at
   runtime; it is not recorded as a Docker build argument or environment layer.
3. Set `CADDY_SITE` to the public hostname, point DNS at the server, and allow
   inbound TCP ports 80 and 443.
4. Build and start the stack:

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 migrate app caddy
```

The `migrate` job runs `scripts/migrate.ts` after PostgreSQL is healthy. The
application waits for that job to finish successfully. The application service
uses the Dockerfile's `runner` target, which contains traced Next.js runtime
files and no development dependencies. The one-shot migration target uses Node
24's native TypeScript stripping and the production dependency set only. Both
the migration and bootstrap targets run as the unprivileged `node` user. The
app receives a 30-second graceful-stop period so Next.js can finish in-flight
requests before a deployment or consistent backup stops it.

After migrations complete, create the initial administrator explicitly. The
profile is excluded from ordinary `docker compose up` runs:

```bash
docker compose --profile bootstrap run --rm bootstrap
```

This target uses production dependencies plus `scripts/bootstrap.ts` and its
schema module. It supports regular administrator creation and password reset;
demo seeding is intentionally not included in a production image.

Caddy terminates TLS and proxies to the internal app service. Its standard
image does not include a rate-limit module, so request-rate limiting belongs in
the application layer; this configuration deliberately does not claim to add a
nonexistent Caddy directive. Caddy limits `POST /api/media` request bodies to
13 MB, leaving room for multipart framing above the application's 12 MiB file
limit.

The app receives `MEDIA_ROOT=/app/data/media`. That location is a named Docker
volume and must be used for uploaded media so it is included in backups.

## Project-local Docker test runtime

This checkout's ignored `.data/runtime` directory contains the user-mode Lima
runtime, Docker client, Compose plugin, and private test configuration used for
local container validation. It does not install anything into the system PATH
or modify a user-level Docker, Colima, or Lima configuration. The following
starts the existing project-local VM and configures only the current shell:

```bash
export DARWIN_RUNTIME="$PWD/.data/runtime"
export LIMA_HOME="$DARWIN_RUNTIME/lima-home"
export DOCKER_CONFIG="$DARWIN_RUNTIME/docker-config"
export DOCKER_HOST="unix://$LIMA_HOME/darwin-docker/sock/docker.sock"
export PATH="$DARWIN_RUNTIME/lima/bin:$DARWIN_RUNTIME/docker-cli/bin:$PATH"

limactl start darwin-docker
docker version
docker compose version
```

The private test stack can then be started without creating a global Docker
configuration. Its Caddy test file uses `tls internal` at
`https://localhost:18443`; browsers must accept that locally generated test
certificate.

```bash
docker compose \
  --env-file "$DARWIN_RUNTIME/compose-test.env" \
  -f compose.yaml \
  -f "$DARWIN_RUNTIME/compose-e2e.yaml" \
  up -d --wait
```

To stop the test services while retaining their named volumes, then stop the
project-local VM:

```bash
docker compose \
  --env-file "$DARWIN_RUNTIME/compose-test.env" \
  -f compose.yaml \
  -f "$DARWIN_RUNTIME/compose-e2e.yaml" \
  stop
limactl stop darwin-docker
```

The normal production commands above remain the deployment interface. The
project-local runtime is a macOS Apple Silicon validation environment and is
ignored by Git; a fresh clone needs its own project-local runtime provisioning.

## Backups and recovery

Start the `db` and `app` services, then create a backup:

```bash
scripts/backup.sh
```

By default, archives are written to `./backups` with mode `0600`. To select a
different directory, set `BACKUP_DIR`:

```bash
BACKUP_DIR=/srv/darwin-backups scripts/backup.sh
```

Each archive contains a PostgreSQL custom-format dump, media files, and a
small manifest. The script stops the app while it dumps PostgreSQL and copies
the media volume, then starts the app again. Its exit trap also attempts to
restart the app after an interrupted backup. It archives only active UUID media
files; retained hidden rollback directories are deliberately excluded. Keep
these archives encrypted and off the production host.

Restore requires an explicit confirmation flag:

```bash
scripts/restore.sh /absolute/path/darwin-journal-YYYYMMDDTHHMMSSZ.tar.gz --confirm=restore-darwin
```

Before changing data, the restore script validates the archive paths, rejects
links and special files, extracts it into a newly created temporary directory,
and checks the PostgreSQL dump with `pg_restore` in a network-isolated
PostgreSQL 17 container. It restores into a new database before renaming it into place, and
stages media before the switch. The prior database and media are retained for
manual rollback; the script never deletes them automatically. If the database
switch begins but the media exchange fails, the app intentionally remains
stopped so it cannot serve a mismatched database and media state.

## Validation status

The project-local PostgreSQL workflow has been started and queried successfully
at `127.0.0.1:55432` with database `darwin`. A project-local Lima VM also ran
Docker Engine 29.8.1 and Docker Compose 5.5.1 without a system Docker,
Colima, Podman, or PostgreSQL service. The final `app` image and independent
`migrate` and `bootstrap` targets built successfully; the app, PostgreSQL, and
Caddy containers reached their health checks over local HTTPS. The empty
installation homepage had no link to an uncreated About page. Caddy's
production and local-TLS configurations both passed `caddy validate`.

Native PostgreSQL recovery and the Docker backup/restore chain were exercised
with database records and a real media file. The complete evidence, including
the retained-media rollback case, is in
[storage-validation.md](docs/qa/storage-validation.md). The Dockerfile uses
fixed patch tags for base images; it does not pin image digests.
