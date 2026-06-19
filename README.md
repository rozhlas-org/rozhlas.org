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
  core/      # config, logger, SQLite schema + migrations (Drizzle), utils
  jobs/      # BullMQ queues (pipeline stages) + Bull Board dashboard
  scrapers/  # page-key -> strategy registry; iradio strategy (rozhlas v2 API)
  media/     # audio acquisition: mp3 download + ffmpeg DASH/HLS remux, ffprobe
  ipfs/      # Kubo RPC client: add/pin + gateway stream verification
  api/       # Hono API — /healthz, /api, Bull Board at /admin/jobs
  worker/    # BullMQ pipeline processors + scheduler
docker/      # api + worker Dockerfiles
scripts/     # dev/smoke/verify scripts
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
**Phase 1 complete** — the `iradio` scrape → IPFS pipeline works end-to-end:
discover (rozhlas v2 podcast API) → upsert metadata → download mp3 → pin to IPFS →
verify streamable via the gateway → (FTS indexing is Phase 2). Audio is never kept on
the server disk. Verify locally with `bun run scripts/verify-phase1.ts` (needs Redis +
a local IPFS daemon). Next: Phase 2 — public site + API + classic search (docs/PLAN.md §11).
