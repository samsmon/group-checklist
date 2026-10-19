# group-checklist

Realtime multi-user checklist app. Built with Bun, Hono, PostgreSQL, and Alpine.js.

**Live:** https://checklist.suryatmaja.dev

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Framework | Hono v4 |
| Database | PostgreSQL (shared-postgres container on the homelab; any Postgres works) |
| Frontend | Vanilla HTML + Alpine.js 3 (vendored in `public/vendor`) — no build step |
| Auth | JWT HS256 via native `crypto.subtle`, httpOnly cookie |
| Realtime | WebSockets via `createBunWebSocket` |
| Hosting | Docker Compose on the homelab (`personal-hosts`), behind Nginx Proxy Manager and Cloudflare |

## Local development

```bash
bun install
cp .env.example .env     # set DATABASE_URL, JWT_SECRET, DB_SSL=disable for a local Postgres, PORT=3000
bun run migrate          # create / update the schema
bun run dev              # http://localhost:3000
```

`JWT_SECRET` is required: the server refuses to start without it.

## Deployment

The app runs from `docker-compose.yml` on the homelab. Full procedure, environment
variables, update and rollback: [docs/deploy-homelab.md](docs/deploy-homelab.md).

Short version, on the host:

```bash
cd /opt/projects/group-checklist
git pull --ff-only
docker compose up -d --build
docker compose exec group-checklist bun scripts/migrate.ts
curl -s localhost:3001/health
```

The old AWS EC2 / Fly.io setup is kept for reference under [`legacy/ec2`](legacy/ec2) and is no longer in use.

## Database migrations

SQL files in [`migrations/`](migrations) run in filename order. `scripts/migrate.ts` records applied files in
`schema_migrations` and skips them next time. A database created before the runner existed is detected and
`001_init.sql` is marked as applied. All migrations are written to be additive and safe to re-run.

```bash
bun run migrate
```

## Security notes

- `JWT_SECRET` is mandatory; auth cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Per-IP rate limits (in memory, reset on restart): login 10 / 15 min, register 5 / hour, writes 120 / min,
  chat and comments 20 / min, import 5 / min. Over the limit returns `429` with `Retry-After`.
- The client IP comes from `cf-connecting-ip`, then `x-forwarded-for`, then `x-real-ip`. The proxy in front must
  be Cloudflare (or overwrite those headers); otherwise clients can spoof their address and dodge the limits.
- Request bodies are capped at 1 MB; text fields have length limits enforced on the server (see `src/lib/validate.ts`).
- Responses carry a Content-Security-Policy (same-origin only; `unsafe-eval` is needed by Alpine's standard build).
  HSTS is left to the edge.
- Public log entries never include IP or user agent; only the project owner's admin view does.
- Guests on public projects can edit items under a self-chosen display name. That is intended, but the name is
  not verified.

## Project layout

| Path | Purpose |
|------|---------|
| `src/index.ts` | Entry point: middleware, rate limits, WebSocket upgrade, static files |
| `src/routes/` | `auth`, `projects`, `items`, `messages`, `logs` |
| `src/lib/` | Access checks (`access.ts`) and input validation (`validate.ts`) |
| `src/middleware/` | Request metadata, audit log writer, rate limiters |
| `public/` | Alpine.js single-page UI (`index.html`, `js/`, `css/`, `vendor/`) |
| `migrations/`, `scripts/migrate.ts` | Schema and migration runner |
| `Dockerfile`, `docker-compose.yml` | Container build and run |
| `legacy/ec2/` | Historical EC2 deployment files (nginx, systemd, init scripts) |

## Scripts

| Command | Purpose |
|---------|---------|
| `bun run dev` | Start with file watching |
| `bun run start` | Start without watching |
| `bun run migrate` | Apply pending migrations |
