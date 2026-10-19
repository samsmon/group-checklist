# Deploy on the homelab

group-checklist runs as a Docker Compose service on the homelab. The server itself is documented in the
`homelab-ops` repo (`docs/services.md`, `docs/architecture.md`); this page covers what is specific to the app.

## Current deployment

| | |
|---|---|
| **URL** | https://checklist.suryatmaja.dev |
| **Host** | LXC `personal-hosts` (SSH alias `personal-hosts`) |
| **Path** | `/opt/projects/group-checklist` (git checkout of `main`) |
| **Runtime** | `docker-compose.yml`: container `group-checklist`, host port `3001` → container `8080` |
| **Proxy** | Nginx Proxy Manager → `personal-hosts:3001`, public through Cloudflare |
| **Database** | `shared-postgres` container on the `shared_net` network, database `group_checklist`, `DB_SSL=disable` |
| **Config** | `.env` next to the compose file (not in git) |

## Environment (`.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `JWT_SECRET` | yes | The app exits at startup if unset. Generate with `openssl rand -hex 32`. Changing it signs everyone out. |
| `DATABASE_URL` | yes | `postgresql://group_checklist_app:<password>@shared-postgres:5432/group_checklist` |
| `DB_SSL` | no | `disable` on the homelab network. `prefer` or `require` for managed databases. |
| `PORT` | no | Must be `8080` to match the compose port mapping. |
| `NODE_ENV` | no | `production` enables the `Secure` cookie flag. |

`.env.example` is the template. Never commit `.env`.

## Updating

```bash
ssh personal-hosts
cd /opt/projects/group-checklist
git fetch --quiet && git status -sb          # tracked files must be clean, branch behind only
git pull --ff-only
docker compose up -d --build
docker compose exec group-checklist bun scripts/migrate.ts
curl -s localhost:3001/health                # {"ok":true,"db":"ok",...}
docker logs --tail 20 group-checklist
```

Before a deploy that adds a migration, check what it will do (`migrations/*.sql`). The runner applies each file once and
all current migrations are additive (`IF NOT EXISTS`).

The n8n auto-deploy workflow described in `homelab-ops/docs/n8n-auto-deploy.md` polls this project too. Check that
document for whether it is still dry-run before assuming a push reaches the server.

## Rolling back

Migrations only add things, so older code keeps working against a migrated database.

```bash
git log --oneline -5                          # pick the last good commit
git checkout <commit>
docker compose up -d --build
```

Return to `main` with `git checkout main` when the fix is in.

## Notes

- The container runs as the unprivileged `bun` user; static files and migrations are baked into the image.
- Rate limiting trusts `cf-connecting-ip`, then `x-forwarded-for`. Traffic through Cloudflare is covered; a request
  straight to NPM on the LAN can spoof its address.
- Backups of `shared-postgres` are handled by the timer described in `homelab-ops` (`scripts/pg-backup.sh`).
- Untracked files such as `.env.pre-central` and `docker-compose.yml.pre-central` on the host are leftovers from the move
  to `shared-postgres`; they are not used.
- Server-side changes (compose, `.env`, containers) are logged in `homelab-ops/CHANGELOG.md` with a lock in its
  `CURRENT_OPS.md`.
