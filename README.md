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
  scrapers/   # page-key -> strategy registry; iradio strategy (rozhlas v2 API)
  media/      # audio acquisition: mp3 download + ffmpeg DASH/HLS remux, ffprobe
  ipfs/       # Kubo RPC client: add/pin + gateway stream verification
  embeddings/ # Voyage AI provider + offline local fallback; embed + vector search
  api/        # Hono API + public site + omnisearch; Bull Board at /admin/jobs
  worker/     # BullMQ pipeline processors + scheduler
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
**Phase 4 complete** — AI omnisearch on top of Phases 0–2:
- **Vector search**: shows embedded into **sqlite-vec**; `/api/omnisearch?q=` and the
  `/omnisearch` page take a natural-language request → intent → semantic KNN merged with
  keyword FTS (hybrid ranking). Embedding happens in the `index` pipeline stage; backfill
  via `bun run scripts/embed-backfill.ts`.
- **Embeddings**: real **Voyage AI** when `VOYAGE_API_KEY` is set; otherwise a deterministic
  **local lexical fallback** so the whole pipeline runs offline (not truly semantic until keyed).
- **Intent** is pluggable (`INTENT_PROVIDER`): **`ollama`** (local LLM on CPU, no API cost —
  default; ships as a Compose service that pulls `qwen2.5:3b`), **`claude`** (paid API), or
  **`heuristic`** (no LLM). Any provider error falls back to heuristic, so search never breaks.

Earlier phases still hold: classic browse/search, the scrape→IPFS pipeline (audio never
kept on the server disk), Bull Board jobs dashboard. The archive taxonomy is
**station + programme**; the app's focus is **četba/čtení**.

Next data step: swap the `iradio` seed feeds to the literary programmes (Četba na
pokračování, Radiokniha, Rozhlasová hra, …) so the archive is genuinely četba-first.
