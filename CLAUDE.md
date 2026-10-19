# group-checklist

Realtime multi-user checklist app. Bun + Hono + PostgreSQL + Alpine.js.
Runs on the homelab (Docker Compose, `personal-hosts`) at https://checklist.suryatmaja.dev.
Deploy details: `docs/deploy-homelab.md`. The old EC2/Fly setup is in `legacy/ec2` and unused.

## Stack

- **Runtime**: Bun (lockfile: `bun.lock`, installs use `--frozen-lockfile`)
- **Framework**: Hono v4
- **DB**: PostgreSQL via the `postgres` driver; `DB_SSL` = `disable` | `prefer` | `require`
- **Frontend**: Vanilla HTML + Alpine.js 3 (vendored in `public/vendor`) + Vanilla JS, no build step
- **Auth**: JWT HS256 via native `crypto.subtle` (NOT hono/jwt — incompatible with Bun)
- **WS**: `createBunWebSocket` from `hono/bun`

## Project structure

```
src/
  index.ts          # Entry: middleware order, rate limits, security headers, WS upgrade, static serve
  db.ts             # Postgres connection
  ws.ts             # rooms Map + broadcastToRoom()
  types.ts          # AppEnv, User types
  routes/
    auth.ts         # Register, login, logout, /me + authMiddleware, JWT helpers
    projects.ts     # CRUD projects, mounts items/logs/messages routers
    items.ts        # CRUD items, PICs, completions, comments, reorder, import, batch delete
    messages.ts     # Project chat
    logs.ts         # Audit log with cursor pagination (ip/user_agent only in admin level)
  middleware/
    logger.ts       # requestMeta (client IP) + writeLog()
    rateLimit.ts    # Per-IP limiters
  lib/
    access.ts       # getProject(), canAccess(), isOwner()
    validate.ts     # readJson, cleanText, parseLimit, isUuid, BadRequest
public/
  index.html        # Alpine.js SPA, light/dark theme, SVG icon sprite
  app.js            # Alpine data object
  js/               # api, auth, projects, items, chat, ws, export, modals, ui
  css/              # vars, layout, items, forms, panels, mobile
  vendor/           # alpine-<version>.min.js (self-hosted)
migrations/         # NNN_name.sql, applied in order by scripts/migrate.ts
scripts/migrate.ts  # Runner; tracks applied files in schema_migrations
Dockerfile, docker-compose.yml
docs/deploy-homelab.md
legacy/ec2/         # historical, do not edit
```

## Auth (CRITICAL)

`hono/jwt` does NOT work in Bun — silently fails on verify. Auth is implemented manually:

- JWT sign/verify in `src/routes/auth.ts` using `crypto.subtle` HMAC-SHA256; payload is encoded as UTF-8
  (`btoa` alone throws on non-Latin1 usernames)
- `JWT_SECRET` is required and at least 32 characters; the module throws at import time otherwise
- Passwords: `Bun.password` with bcrypt cost 12 (native, off the main thread; bcryptjs blocked the event loop for
  ~300 ms per call). It verifies the `$2a$/$2b$` hashes bcryptjs made. Login verifies against a dummy hash when the
  username does not exist so timing does not reveal accounts
- Cookie: httpOnly, SameSite=Lax, 30 days, `Secure` in production
- Cookie read: `c.req.header("cookie")` with regex parser — do NOT use `hono/cookie`
- Login/register return raw `Response` (not `c.json()`) to set `Set-Cookie` header
- Frontend: `credentials: 'include'` on all fetch calls
- Tokens are not revocable (stateless, 30 days)

## Request handling rules

- Read bodies with `readJson(c)` and text with `cleanText(value, max, field)`; both throw `BadRequest`, which the
  global handler turns into a 400. Other errors return a generic 500 (details only in the server log).
- Validate every id that reaches SQL with `isUuid` (or `itemInProject` for item sub-resources) so malformed ids
  return 404/400 instead of a Postgres error.
- Item sub-resources (completion, PICs, comments) must be scoped to the project in the URL, not just `item_id`.
- `/ws/:slug` runs the same `canAccess` check as the REST API before upgrading.
- Client IP: `cf-connecting-ip`, then `x-forwarded-for`, then `x-real-ip` (see `middleware/logger.ts`).

## Database

PostgreSQL on the homelab (`shared-postgres`). Add schema changes as a new `migrations/NNN_name.sql`
(additive and idempotent: `IF NOT EXISTS`), then run `bun scripts/migrate.ts`. Never edit an applied migration.

Key tables: `users`, `projects`, `checklist_items` (`item_type` = task | section), `item_pics`,
`item_completions`, `item_comments`, `project_messages`, `logs`.

## Alpine.js reactivity (CRITICAL)

Never mutate array item properties in place. Always replace the entire item object:

```js
// WRONG - Alpine won't detect
this.items[idx].completion = data;
this.items[idx].pics.push(pic);

// CORRECT
this.items[idx] = { ...this.items[idx], completion: data };
this.items[idx] = { ...this.items[idx], pics: [...this.items[idx].pics, pic] };
```

This applies to: completion, pics, and any other nested property.

## Static files

Served by `serveStatic` with gzip (`hono/compress`) and `ETag`; `/fonts` and `/vendor` are `immutable` for a year
(never change a file under the same URL: rename it), everything else is `no-cache` so it revalidates (304).
Compression and ETag skip `/api`, `/ws` and `/health`. Unknown `/api/*` paths return a JSON 404.

## Frontend notes

- **Design: "Ledger"** (a printed worksheet). Serif (Newsreader) for words, mono (IBM Plex Mono) for facts such as
  times, PIC names and counts. Paper, ink and one ink-blue accent reserved for state (done, links, focus).
  Reference: `docs/design/mockup-ledger.html`.
- Fonts are self-hosted in `public/fonts` (SIL OFL, licenses alongside); `@font-face` lives in `css/vars.css`.
- Tokens live in `css/vars.css` (`--paper`, `--ink`, `--muted`, `--rule`, `--accent`, `--danger`); dark mode overrides
  the same tokens. Older names (`--bg`, `--text`, ...) are aliases. Check any new color pair against WCAG AA.
- Avoid: cards with rounded corners or soft shadows, pill badges, left accent stripes, stat tiles, emoji, gradients.
  Use hairline rules, 0 radius, text links for secondary actions, one filled button per dialog.
- Icons are an inline SVG sprite at the top of `index.html`: `<svg class="icon"><use href="#i-name"/></svg>`.
  Keep icons to functional ones (check, chevron, edit, delete, comment).
- Print: `css/items.css` has a print block so a checklist prints as a clean sheet.
- CSP allows only same-origin scripts plus `unsafe-eval` (Alpine) and inline styles. Do not add third-party
  script or style origins; vendor the file instead.
- Input `maxlength` values mirror the server limits (title 200, description/notes/comments/chat 2000, names 100,
  username 32, password 128).

## SQL gotchas

`FILTER (WHERE ...)` only works with aggregate functions. For non-aggregates use `CASE WHEN`:

```sql
-- WRONG
jsonb_build_object(...) FILTER (WHERE ic.id IS NOT NULL)

-- CORRECT
CASE WHEN ic.id IS NOT NULL THEN jsonb_build_object(...) END
```

## WebSocket

- `src/ws.ts`: room per project slug, `Map<slug, Map<socket, {userId, ip}>>`; `canJoin`/`joinRoom`/`leaveRoom`,
  `broadcastToRoom(slug, payload)`, `closeRoom(slug, keepUserId, code, reason)`
- Limits: 20 sockets per IP, 200 per room, 1 KB message size (`maxPayloadLength`), 60 connects/min/IP
- Authorisation happens at connect only. When a project turns private (`PATCH`) or is deleted, `closeRoom` drops the
  other sockets with code 4403/4404; the client shows a notice and does not reconnect on those codes
- Client reconnects with backoff (3s, 6s ... 30s) on other closes, heartbeat ping every 25s; after a reconnect or
  when the tab becomes visible again it reloads items and chat
- Events: `item.created`, `item.updated`, `item.deleted`, `item.reordered`, `item.completed`, `item.uncompleted`,
  `item.pic_added`, `item.pic_removed`, `comment.added`, `comment.deleted`, `message.created`,
  `project.updated`, `project.deleted`

## Development

```bash
bun install
cp .env.example .env     # JWT_SECRET, DATABASE_URL, DB_SSL=disable, PORT=3000
bun run migrate
bun run dev
```

`.env` is gitignored. There is no test suite or CI yet.

## Known patterns

- `getProject(slug)` returns project row or null — check before use
- `canAccess(project, userId)` — true if public or owner
- `isOwner(project, userId)` — true only if owner
- `writeLog()` wraps in try/catch — log failure never crashes the request
- Guest users: name stored in `localStorage.guestName`, passed as `actor_name` in request body (not verified)
