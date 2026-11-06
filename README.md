<div align="center">

# group-checklist

**Realtime multi-user collaborative checklist platform with sub-millisecond sync.**

[![Bun](https://img.shields.io/badge/Bun-1.1+-000000?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![Hono](https://img.shields.io/badge/Hono-v4-E36002?style=flat-square&logo=hono&logoColor=white)](https://hono.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Alpine.js](https://img.shields.io/badge/Alpine.js-3-8BC0D0?style=flat-square&logo=alpinedotjs&logoColor=white)](https://alpinejs.dev)
[![WebSockets](https://img.shields.io/badge/WebSockets-Realtime-4A154B?style=flat-square)](#architecture)
[![Docker](https://img.shields.io/badge/Docker-Homelab-2496ED?style=flat-square&logo=docker&logoColor=white)](docs/deploy-homelab.md)

**Live Production:** [checklist.suryatmaja.dev](https://checklist.suryatmaja.dev)

[Architecture](#architecture) • [Features](#features) • [Tech Stack](#tech-stack) • [Quick Start](#quick-start) • [Deployment](#deployment--homelab-runbook) • [Migrations & Testing](#migrations--testing) • [Directory Layout](#directory-layout) • [Troubleshooting](#troubleshooting--diagnostics) • [Documentation](#modular-documentation-index)

</div>

---

> **Built for distributed teams and homelab operators** who require low-latency, real-time shared checklists without bloated frontend build toolchains or third-party cloud dependencies. group-checklist pairs Bun's ultra-fast native runtime and Hono v4 with room-based WebSockets, reactive Alpine.js stores, and robust PostgreSQL persistence.

---

## Architecture

```mermaid
flowchart TD
    subgraph Clients[" Browser Client Layer "]
        Web["Alpine.js 3 SPA<br/>(Vendored Zero-Build)"]
        Store["Reactive Store & WS Client<br/>(Auto-reconnect & Heartbeat)"]
    end

    subgraph Engine[" Bun & Hono Runtime Engine "]
        Router["Hono v4 HTTP Router<br/>(/api/auth, /projects, /items)"]
        WS["WebSocket Server<br/>(createBunWebSocket /ws/:slug)"]
        Auth["Security & JWT Subsystem<br/>(Native crypto.subtle HS256)"]
        Rate["Security Headers & Limiter<br/>(CSP, Sliding Window Memory)"]
    end

    subgraph Storage[" State & Infrastructure "]
        DB[("PostgreSQL 16<br/>(Shared DB & Migrations)")]
        Docker["Homelab Docker Service<br/>(Nginx Proxy Manager + Cloudflare)"]
    end

    Web <-->|Reactive State| Store
    Store <-->|WebSocket Stream /ws/:slug| WS
    Store <-->|REST Requests| Router
    Router --> Auth
    Router --> Rate
    WS --> Auth
    Router --> DB
    WS -.->|Room Broadcasts| Store
    Docker -.->|Hosts Container :3001| Engine
```

---

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>Realtime Collaboration & UI</h4>
      <ul>
        <li><strong>Instant WebSocket Sync</strong>: Room-scoped broadcasting (<code>/ws/:slug</code>) propagates item checks, edits, and reordering to all connected peers in sub-milliseconds.</li>
        <li><strong>Alpine.js Reactive Store</strong>: Single-source-of-truth store with optimistic UI updates and instant DOM reactivity.</li>
        <li><strong>Zero-Build Client</strong>: Pure HTML5, modular CSS, and vendored Alpine.js—no bundlers, transpilations, or npm pipelines.</li>
        <li><strong>Automatic Reconnection</strong>: Resilient socket loop with 25-second heartbeat pings, exponential backoff, and state re-synchronization.</li>
        <li><strong>Project Lists & Groups</strong>: Organize checklists into projects, color-tagged groups, pinned items, and archive views.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h4>Security & Backend Architecture</h4>
      <ul>
        <li><strong>Native <code>crypto.subtle</code> HS256</strong>: High-speed, spec-compliant JWT signing and verification stored in <code>HttpOnly</code>, <code>SameSite=Lax</code> cookies.</li>
        <li><strong>Bun Native Engine</strong>: Zero-overhead TypeScript execution, native HTTP server, and asynchronous off-thread bcrypt hashing (cost 12).</li>
        <li><strong>Sequential Migration Runner</strong>: Deterministic SQL runner tracking schema versions in <code>schema_migrations</code>.</li>
        <li><strong>Homelab Docker Container</strong>: Hardened container running as unprivileged <code>bun</code> user with strict 512 MB memory limit and native health checks.</li>
        <li><strong>Granular Rate Limiting</strong>: Sliding-window memory rate limiters for auth, socket joins, chat messages, and imports.</li>
      </ul>
    </td>
  </tr>
</table>

---

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| **Runtime Engine** | Bun 1.1+ | High-throughput JavaScript/TypeScript runtime & native HTTP engine |
| **Backend Framework** | Hono v4 | Lightweight routing, middleware stack, secure headers, body limiter |
| **Realtime Engine** | Bun WebSockets (`createBunWebSocket`) | Low-latency room multiplexing, peer joins, and state broadcasts |
| **Database** | PostgreSQL 16 (`postgres.js`) | Relational persistence, transactional checklist operations, audit logs |
| **Frontend UI** | Alpine.js 3 + Vanilla CSS | Reactive single-page UI vendored in `public/vendor` (zero-build) |
| **Authentication** | Web Crypto API (`crypto.subtle`) | Zero-dependency HS256 JWT tokens & Bun native bcrypt |
| **Testing Harness** | Bun Test + PGlite | Embedded in-process PostgreSQL test runner without external daemons |
| **Deployment** | Docker & Compose | Containerized homelab deployment behind Nginx Proxy Manager & Cloudflare |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.1+
- PostgreSQL 14+ (or Docker Compose for local PostgreSQL)
- Git 2.40+

### Setup in 4 Steps

```bash
# 1. Clone repository and install dependencies
git clone https://github.com/suryatmaja/group-checklist.git
cd group-checklist
bun install

# 2. Configure environment variables
cp .env.example .env
# Ensure JWT_SECRET is set (min 32 characters) and configure DATABASE_URL

# 3. Apply database schema migrations
bun run migrate

# 4. Start local development server with file watching
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the checklist dashboard.

---

## Deployment & Homelab Runbook

The production instance is hosted as a Docker Compose service on the homelab network (`personal-hosts`) behind Nginx Proxy Manager and Cloudflare edge encryption.

### Production Update Workflow

```bash
# SSH into homelab host and pull updates
cd /opt/projects/group-checklist
git fetch --quiet && git status -sb
git pull --ff-only

# Rebuild and start container in background
docker compose up -d --build

# Run pending database migrations
docker compose exec group-checklist bun scripts/migrate.ts

# Verify health status
curl -s http://localhost:3001/health
```

### Health Check

The endpoint `GET /health` executes a live ping against PostgreSQL (`SELECT 1`).
- **200 OK**: `{"ok":true,"db":"ok","ts":"..."}` (healthy container).
- **503 Service Unavailable**: Database unreachable; triggers Docker automated container restart.

For environment variable matrices, automated deployments, and rollback procedures, refer to [docs/deploy-homelab.md](docs/deploy-homelab.md).

---

## Migrations & Testing

### Database Migrations

SQL migrations in [`migrations/`](migrations) run sequentially by filename. `scripts/migrate.ts` checks and records applied files in `schema_migrations`. All migrations are additive (`IF NOT EXISTS`), guaranteeing backward compatibility during rollbacks.

```bash
# Run pending migrations
bun run migrate
```

### Automated Test Suite

Unit and integration tests run under `bun test`. Test runs use an embedded, in-process PostgreSQL instance ([PGlite](https://pglite.dev)), requiring zero local database setup.

```bash
# Execute full test suite
bun test

# Run tests against an external database instance
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/checklist_test bun test
```

---

## Directory Layout

| Directory / File | Component & Purpose |
|---|---|
| `src/index.ts` | Server bootstrap, global security middleware, rate limiters, WebSocket upgrade |
| `src/routes/` | Modular endpoints for authentication, projects, groups, items, and audit logs |
| `src/middleware/` | Per-IP sliding-window rate limiters, request context metadata, and audit logger |
| `src/lib/` | Cryptographic JWT verification (`crypto.subtle`), RBAC access rules, and validators |
| `src/ws.ts` | WebSocket room manager, heartbeat handler, and broadcast engine |
| `public/` | Alpine.js single-page application (`index.html`, `js/`, `css/`, `vendor/`) |
| `migrations/` | Sequential SQL migration scripts (`001_init.sql`, `002_*.sql`, etc.) |
| `scripts/migrate.ts` | Deterministic database migration runner tracking `schema_migrations` |
| `tests/` | Test suites executed via `bun test` backed by in-memory PGlite |
| `docs/` | Deep operational runbooks, architecture specs, and UI design mockups |
| `legacy/` | Archived AWS EC2 configuration and deployment automation |

---

## Troubleshooting & Diagnostics

| Symptom | Probable Cause | Immediate Remediation |
|---|---|---|
| Server exits immediately on startup | `JWT_SECRET` missing or < 32 chars | Generate secret via `openssl rand -hex 32` and set `JWT_SECRET` in `.env`. |
| `503 Service Unavailable` on `/health` | PostgreSQL unreachable or credentials invalid | Verify `DATABASE_URL` and container networking (`docker compose ps`). |
| `429 Too Many Requests` | IP rate limit exceeded | Wait for cooldown or check reverse proxy forwarding headers (`cf-connecting-ip`). |
| WebSocket fails to connect / drops | Project is private or socket limit reached | Ensure user is authenticated as project owner or check per-IP socket limits (max 20). |
| Migration lock or schema error | Unapplied or conflicting migration | Run `bun run migrate` locally or `docker compose exec group-checklist bun scripts/migrate.ts`. |

---

## Known Gaps & Design Boundaries

- **Single-Node WebSocket State**: In-memory rooms and sliding-window rate limiters operate per-process; horizontal multi-replica scaling requires a distributed PubSub broker.
- **Client Script Evaluation**: Content-Security-Policy includes `'unsafe-eval'` to enable Alpine.js dynamic expression evaluation without an external JS compiler.
- **Guest Identity**: Guests on public projects provide self-selected display names without server-side verification.
- **Edge Reconnection**: Client reconnect cycles perform full project state fetches instead of incremental delta log replay.

---

## Modular Documentation Index

Deep operational guides, design artifacts, and legacy infrastructure documentation are maintained modularly:

| Document | Description | Target Audience |
|---|---|---|
| [Homelab Deployment Runbook](docs/deploy-homelab.md) | Host paths, reverse proxy configs, environment specs, and rollback procedures | SRE & System Operators |
| [Design Mockups](docs/design/) | Utilitarian UI mockups and ledger interface design explorations | Frontend Developers & Designers |
| [Legacy Deployments](legacy/ec2/) | Historical AWS EC2 systemd, Nginx, and cloud-init scripts (archived) | Technical Historians & Reference |

---

## License

Distributed under the [MIT License](LICENSE).
