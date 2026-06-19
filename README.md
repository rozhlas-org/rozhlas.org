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
**Phase 2 complete** — public site + JSON API + classic search on top of the Phase 1
pipeline:
- **JSON API**: `/api/shows` (paginate + filter by programme/source/`q`),
  `/api/shows/:slug`, `/api/search`, `/api/programmes`, `/api/sources`.
- **Site** (server-rendered, plain/semantic — a design system replaces
  `packages/api/src/public/styles.css`): home grid, programme listing/filter, search,
  show detail with an audio player streaming from the IPFS gateway.
- **Search**: accent-insensitive FTS5 over title/description/programme, trigger-synced.

The archive's taxonomy is **station + programme** (no flat genres); the app's focus is
**četba/čtení** (literary readings). Phase 1's pipeline still works end-to-end (audio
never kept on the server disk). Next: Phase 4 — AI omnisearch (docs/PLAN.md §9, §11).
