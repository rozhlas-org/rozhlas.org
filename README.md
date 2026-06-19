# rozhlas.org

Scraper + web player for Czech Radio (rozhlas.cz) shows. Scrapes shows on a schedule,
stores metadata in SQLite, pushes audio to a self-hosted IPFS node, and serves a public
site + API. See **[docs/PLAN.md](docs/PLAN.md)** for the full design.

## Stack
TypeScript on **Bun** · **SQLite** (Drizzle) · **BullMQ** + **Bull Board** (Redis) ·
self-hosted **IPFS** (Kubo) · **Hono** API + **Astro** site (Phase 2) · Docker Compose.

## Monorepo layout
```
packages/
  core/    # config, logger, SQLite schema + migrations (Drizzle)
  jobs/    # BullMQ queues (pipeline stages) + Bull Board dashboard
  api/     # Hono API — /healthz, /api, Bull Board at /admin/jobs
  worker/  # BullMQ workers (stage processors; stubs until Phase 1)
docker/    # api + worker Dockerfiles
scripts/   # dev/smoke scripts
```

## Run with Docker (full stack)
```bash
cp .env.example .env        # fill in secrets; .env is gitignored
docker compose up --build   # web · worker · redis · ipfs(kubo)
```
- API + health: http://localhost:3000/healthz
- Job dashboard: http://localhost:3000/admin/jobs
- IPFS gateway: http://localhost:8080

## Run locally (without Docker)
Requires [Bun](https://bun.sh) and a local Redis.
```bash
bun install
cp .env.example .env

# start Redis (or: docker run -p 6379:6379 redis:7-alpine)
redis-server --daemonize yes

bun run db:generate   # regenerate migrations after schema changes
bun run db:migrate    # apply migrations -> ./data/rozhlas.db

bun run api           # http://localhost:3000  (api + /admin/jobs)
bun run worker        # processes the pipeline queues
```

## Useful scripts
| Command | What |
|---|---|
| `bun run typecheck` | Typecheck the whole workspace |
| `bun run db:generate` | Generate a Drizzle migration from the schema |
| `bun run db:migrate` | Apply migrations |
| `bun run scripts/smoke.ts` | Enqueue a job and confirm a worker processes it |

## Status
**Phase 0 (foundations) complete** — bootable empty stack: monorepo, Docker Compose,
DB schema + migrations, BullMQ queues, Bull Board, health checks. Next: Phase 1 — the
`iradio` scrape → IPFS pipeline (see docs/PLAN.md §11).
