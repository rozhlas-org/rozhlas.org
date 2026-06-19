# rozhlas.org — Project Plan

> A scraper + web player for Czech Radio (rozhlas.cz) shows. Shows are scraped on a
> schedule, their metadata stored in SQLite, their audio pushed to a self-hosted IPFS
> node (never publicly stored on the server itself), and surfaced through a public
> static site + API with classic browse/search today and AI "omnisearch" later.

## 1. Purpose & scope

**Goal:** continuously archive radio shows and make them explorable two ways:

1. **Classic** — list, paginate, filter by category/date/show, full-text search.
2. **Omnisearch (later)** — natural-language intent search ("I'm driving alone and
   need something fun to cheer me up") resolved via an LLM + RAG over rich metadata.

**Non-goals (for now):** user accounts, comments, playlists/social features, mobile
apps. The site is read-only and public.

### Scrape targets (pluggable, continuously added)
- `iradio` — https://hledani.rozhlas.cz/iradio/ (search/listing surface)
- `wave-audiobooks` — https://wave.rozhlas.cz/audioknihy-radia-wave-9166009 (example
  collection page)
- …more added over time as independent scraper plugins.

### How content is actually reached (recon)
Listing/archive page → **show detail page** → the audio is exposed as **`.m4s`
segments** (fragmented MP4, i.e. DASH/HLS streaming), **not** a direct mp3. Acquiring it
means fetching the manifest + segments and assembling them with **ffmpeg** — a
long-running, failure-prone step, which is the whole reason for the job/queue system.
Every source/page is structured differently, so **each gets its own scrape strategy**
(see §5).

## 2. Decisions locked in
- **Runtime/language:** TypeScript on **Bun**.
- **Audio acquisition:** source is **DASH/HLS `.m4s` segments** reached from each show's
  detail page — fetched & assembled with **ffmpeg** in the `acquire-audio` job. ffmpeg
  ships in the worker Docker image.
- **Metadata store:** **SQLite** (single source of truth for app data).
- **Jobs/queue:** **BullMQ** (Redis-backed) with the **Bull Board** dashboard for
  planned/active/failed/completed visibility. Scrapers run as scheduled (repeatable)
  jobs.
- **IPFS:** **self-hosted Kubo** node + local gateway. Audio is added & pinned locally;
  the server keeps no public copy outside IPFS.
- **Deployment:** **Docker Compose** on this server (web · worker · redis · ipfs · sqlite volume).
- **Frontend:** **Astro** (static output) for the public site + **Hono** for the JSON API.
- **AI (later):** **Voyage AI** embeddings (Anthropic has no embeddings endpoint) +
  vector search in SQLite (`sqlite-vec`); **Claude Opus 4.8** (`claude-opus-4-8`) for
  natural-language query understanding via structured outputs.

## 3. High-level architecture

```
                ┌──────────────── Docker Compose (this server) ─────────────────┐
                │                                                                │
  rozhlas.cz ──▶│  worker (BullMQ)                                              │
   (scrape)     │   ├─ discover  ─ scheduled per source → enqueues show jobs    │
                │   ├─ fetch-metadata ─ detail page → upsert SQLite + MediaSrc │
                │   ├─ acquire-audio ─ ffmpeg: DASH/HLS .m4s → temp file        │
                │   ├─ extract-tags ─ tags/artwork/parts → SQLite               │
                │   ├─ ipfs-add ─ add+pin to Kubo, store CID, delete temp       │
                │   ├─ ipfs-verify ─ gateway range request → streamable?        │
                │   └─ index ─ FTS5 now, embeddings later                       │
                │        │                  │                  │                 │
                │     [redis]            [sqlite vol]       [kubo ipfs]          │
                │        │                  │                  │                 │
                │  web (Astro static + Hono API + Bull Board /admin)            │
                └────────────────────────────────────────────────────────────────┘
                                     │ HTTP
                          public site + /api + IPFS gateway stream
```

Key rule: **audio is never served from the app's own disk.** Temp files are deleted
right after `ipfs-add`; playback streams from the IPFS gateway by CID.

## 4. Repository layout (Bun workspaces / monorepo)

```
rozhlas.org/
├─ docker-compose.yml
├─ packages/
│  ├─ core/           # db (Drizzle + SQLite), schema, migrations, config, logging
│  ├─ jobs/           # BullMQ queues, job types, schedules, Bull Board mount
│  ├─ scrapers/       # plugin registry + one module per source
│  │  ├─ registry.ts
│  │  ├─ iradio/
│  │  └─ wave-audiobooks/
│  ├─ ipfs/           # Kubo client wrapper (add, pin, verify-streamable)
│  ├─ media/          # audio download + tag/artwork extraction
│  ├─ worker/         # BullMQ worker process entrypoint(s)
│  ├─ api/            # Hono app (JSON API, shared by web)
│  └─ web/            # Astro static site + player, consumes api
└─ docs/PLAN.md       # this file
```

## 5. Scraper plugin contract — a page-key → strategy registry

Every source/page is laid out differently, so the system is a **registry mapping a
simplified page-key to a scrape strategy**. New pages are added by registering a new
key + strategy — no changes elsewhere.

```ts
// registry: simplified page-key → how to scrape it
const SCRAPERS: Record<string, Scraper> = {
  "iradio":          iradioStrategy,        // hledani.rozhlas.cz/iradio archive
  "wave-audiobooks": waveAudiobookStrategy, // wave.rozhlas.cz collection page
  // …add a key per page/source over time
};

interface Scraper {
  key: string;                              // "iradio"
  schedule: string;                         // cron, e.g. "0 */6 * * *"
  discover(ctx): AsyncIterable<ShowRef>;    // crawl listing/archive → show refs
  fetchShow(ref, ctx): Promise<ScrapedShow>;// open detail page → metadata + MediaSource
}

// fetchShow returns the streaming descriptor, not a file
interface MediaSource {
  kind: "dash" | "hls" | "file";            // m4s segments are dash/hls
  manifestUrl: string;                      // .mpd / .m3u8 (or direct URL for "file")
  headers?: Record<string, string>;         // referer/cookies if the CDN needs them
}
```
- Static pages → `fetch` + `cheerio`. JS-rendered pages → **Playwright** (already
  installed on this machine via gstack). Pick per-strategy.
- `discover` is idempotent and resumable; it enqueues `fetch-metadata` jobs deduped by
  `(source, source_id)`.
- `fetchShow` resolves the **manifest/m4s URL** (and any required headers) into a
  `MediaSource`; the actual download+assembly happens in the `acquire-audio` job (§7).
- Be a good citizen: per-source rate limiting, concurrency caps, `User-Agent`, respect
  `robots.txt`, conditional requests / ETag where possible. See §10.

## 6. Data model (SQLite, via Drizzle ORM)

Core tables (indicative):
- `sources` — registered scrapers, last run, enabled.
- `shows` — id, source, source_id (unique per source), slug, title, description,
  published_at, duration_sec, show/series name, language, raw_json.
- `show_parts` — multi-part shows/episodes (order, title, duration, own audio).
- `people` — hosts/authors; `show_people` join (role).
- `categories`, `tags` + join tables.
- `artworks` — show_id, ipfs_cid|url, width/height, role (cover/thumb).
- `audio_files` — show_id/part_id, ipfs_cid, container/codec (e.g. m4a/AAC),
  manifest_url + manifest_kind (dash/hls) of the source stream, bitrate, size, duration,
  streamable (bool, from ipfs-verify), checksum.
- `shows_fts` — FTS5 virtual table (title, description, people, tags) for classic search.
- **Later:** `embeddings` (object_id, model, vector via `sqlite-vec`), `transcripts`.

Job/run bookkeeping lives in Redis (BullMQ); a thin `scrape_runs` audit table in SQLite
records per-run summaries (counts, errors) for the admin UI/history.

## 7. Job pipeline & queues

Queues (BullMQ), each with retries + exponential backoff + dead-letter visibility in
Bull Board:

| Queue | Trigger | Work |
|------|---------|------|
| `discover` | repeatable (per-source cron) | crawl listing → enqueue `fetch-metadata` |
| `fetch-metadata` | from discover | scrape show page → upsert show + relations |
| `acquire-audio` | after metadata, if new/changed | **ffmpeg** fetches the DASH/HLS manifest + `.m4s` segments and assembles them → single temp file |
| `extract-tags` | after acquire | tags/artwork/parts → DB; embed metadata into the file |
| `ipfs-add` | after extract | add+pin to Kubo, save CID, **delete temp** |
| `ipfs-verify` | after add | gateway range request → set `streamable` |
| `index` | after verify | refresh FTS row (+ embeddings later) |

Idempotency: every stage keys off stable IDs and checksums so re-runs are safe. A show
already pinned with an unchanged checksum short-circuits.

## 8. Public site & API

- **Astro static site** with an HTML5 audio player; audio `src` is the IPFS gateway URL
  for the CID. Server-rendered/static pages for SEO and for the future AI layer to crawl.
- **Hono JSON API** (shared by the site and external consumers):
  - `GET /api/shows` — paginate + filter (category, source, date range, people).
  - `GET /api/shows/:slug` — full detail incl. parts + stream URLs.
  - `GET /api/search?q=` — classic FTS search.
  - `GET /api/categories`, `/api/sources`.
  - **Later:** `POST /api/omnisearch` — natural-language query (see §9).
- **Admin:** Bull Board mounted at `/admin/jobs` (auth-gated, internal only) for
  planned/running/failed jobs.

## 9. AI omnisearch (later stage — design now, build later)

Pipeline for a query like *"driving alone, need something fun to cheer me up"*:
1. **Understand** — `claude-opus-4-8` with **structured outputs** turns the NL query
   into a typed intent: `{ mood, energy, themes[], duration_pref, format, exclude[] }`.
2. **Retrieve (hybrid)** — combine FTS keyword hits with **vector similarity** over
   embeddings of `title + description + (later) transcript`. Vectors stored in SQLite via
   **`sqlite-vec`**; embeddings from **Voyage AI** (e.g. a `voyage-3`-class model).
3. **Rank/explain** — optionally an LLM re-rank/short blurb ("why this fits your mood").

To make this possible the metadata/RAG layer must be rich from day one: store full
descriptions, people, categories, durations, and keep raw HTML/JSON so we can re-derive
fields. **Transcripts via ASR (e.g. Whisper)** are a candidate later input for deeper RAG.

Notes:
- Anthropic provides **no embeddings API** — embeddings come from Voyage AI (Anthropic's
  documented recommendation) or another provider; Claude does the query-understanding and
  optional re-ranking only.
- Keep the embedding model + dimensions recorded per row so we can re-embed on upgrades.

## 10. Legal, ethical & operational guardrails
- Content is Czech Radio's. Re-hosting copyrighted audio publicly via IPFS carries
  copyright/ToS risk — treat this as a known open question; prefer archival/personal-use
  framing and be ready to restrict to private/auth'd access if needed.
- Respect `robots.txt`, rate-limit politely, identify the crawler, cache conditionally,
  and avoid hammering source servers.
- IPFS pins grow without bound — plan disk monitoring and a retention/GC policy for the
  Kubo datastore.
- Secrets (`GITHUB_TOKEN`, future `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`) live in `.env`
  (gitignored), injected via Compose env.

## 11. Milestones
- **Phase 0 — Foundations:** monorepo + Bun workspaces, Docker Compose (redis, kubo,
  sqlite vol), Drizzle schema + migrations, BullMQ + Bull Board, config/logging.
- **Phase 1 — First pipeline:** `iradio` scraper end-to-end (discover → metadata →
  download → tags → ipfs-add → verify → index). Prove the IPFS streaming path.
- **Phase 2 — Public site:** Astro site + player + Hono API; classic browse, paginate,
  categories, FTS search.
- **Phase 3 — Generalize:** `wave-audiobooks` scraper; harden the plugin contract,
  scheduling, retries, dedup, monitoring.
- **Phase 4 — AI omnisearch:** Voyage embeddings + `sqlite-vec`, Claude intent parsing,
  hybrid retrieval, `/api/omnisearch`; explore transcripts/ASR.

## 12. Open questions to revisit
- **Output container/codec:** the source is AAC-in-`.m4s`. Prefer **remux to `.m4a`
  (stream copy, no re-encode → fast, lossless)** over transcoding to mp3; revisit if mp3
  + ID3 is specifically required. Decide tagging approach per container.
- Copyright/access posture (fully public vs gated) — affects auth + caching.
- Embedding model/provider choice and cost ceiling for the archive size.
- Whether to add ASR transcripts (storage + compute) for richer RAG.
- IPFS durability: stay self-hosted only, or add remote pinning later for redundancy.
