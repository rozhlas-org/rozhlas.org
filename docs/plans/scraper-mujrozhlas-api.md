# Plan: replace station HTML crawling with the mujRozhlas API (RSS-first)

> Revised after engineering review. Headline changes: **RSS-first** (not co-primary
> JSON:API); **sourceId reconciliation is a blocking Phase-1 gate**; the **part-granularity
> mismatch** is an explicit design decision; rollback is a reversible config swap.

## Problem

The station scrapers (`cetba`, `pohadka`, `junior-pribehy`, `wave-audiobooks`) discover shows
by **crawling HTML** (`makeStationScraper`): BFS from a programme page, following `/slug-<id>`
links, paginating `?page=N`, fetching every candidate page to classify it as reading vs listing.

Proven wrong in production:
- **Fetch amplification** — ~8 fetches per reading (892 fetches → 114 readings); every
  candidate page is downloaded just to classify it.
- **Rate-limited** — Dvojka returns **HTTP 403**; a 10-min `pohadka` run does ~368 fetches → 20
  readings (`new=0`). Effectively no coverage.
- **Fragile scoping** — depth-2 wandered into unrelated shows ("Oldies jako na dlani").

Shipped mitigations (watchdog, fetch budget, per-source delay, depth-1 scope) made runs
**bounded and observable** but don't fix coverage.

## Goal

Discover a programme's full episode list from a structured feed/API — paginated, cheap, no junk
pages, no 403 storms — mapped to our existing `ScrapedShow` shape so the pipeline (upsert →
acquire-audio → ipfs → index) is unchanged, **and without double-ingesting the existing
HTML-era rows**.

## What we know (recon)

- `iradio` already ingests via `api.mujrozhlas.cz/.../rss/podcast/<uuid>.rss` using
  `parsePodcastFeed` — full episode lists with direct mp3. **This is the proven path.**
- `api.mujrozhlas.cz` is a live JSON:API; station pages embed a show UUID and reference
  `rapi/view/show/<uuid>` (exact episodes endpoint unconfirmed — `rapi/view/show/<uuid>` 404'd).
- Episodes aren't in the station page's initial HTML; the hajaja node-id `7230824` returned an
  **empty** v2 feed — i.e. the node-id is *not* the feed id.

## Decision: RSS-first

RSS is the committed default, because `iradio`/`parsePodcastFeed` already works against the same
host. **JSON:API is an escalation only for a programme whose RSS feed is confirmed truncated.**
This collapses most of the build to "find each programme's feed UUID + reuse `parsePodcastFeed`".

Two hazards are properties of the *data*, not of the transport, so they must be solved whichever
wins — and they are the real Phase-1 questions (see below).

## Phase 1 findings — SPIKE COMPLETE ✅ (pohadka)

The endpoint is confirmed and clean. **Decision flips to JSON:API for station shows** (RSS not
needed — the node-id RSS was empty anyway; JSON:API gives full archive + native part/mirror data).

- **Endpoint:** `GET https://api.mujrozhlas.cz/shows/<uuid>/episodes` (JSON:API). No auth, no 403,
  fast. The `<uuid>` is embedded in each station page (Hajaja `061d0467-…`, Pohádka `9704b880-…`);
  `shows/<uuid>` returns the show with an `episodes` relationship link.
- **Pagination / truncation:** NOT truncated. `page[limit]`/`page[offset]` cursor via
  `links.next`/`links.last`, total in `meta.count`. Verified page 2 returns fresh episodes.
- **Archive is SMALL:** Hajaja **81** episodes, Pohádka **8** → the whole `pohadka` source ≈ **89**
  (3 + 1 API calls). The HTML crawler's "hundreds of pages" was ~90% nav/related overhead.
- **(#3 node-id) RESOLVED — node-id is NOT exposed** (no `drupal_internal__nid`; episode `id` is a
  UUID). So we cannot pin `sourceId` to the legacy node-id. Strategy instead:
  - Use the **episode UUID as `sourceId`** and **move all station sources to the API together**, so
    everything is one UUID namespace and the existing sourceId-only cross-source dedup works
    natively (same episode UUID under different sourceKey → mirror skip).
  - The API also carries **native mirror metadata** — `mirroredShow`, `mirroredSerial{title,
    totalParts}` on every episode — a better mirror signal than the node-id hack.
  - Existing HTML-era rows are small (pohadka 26, cetba 25, wave 2, junior 75) → one-time cleanup:
    delete the old node-id rows and re-ingest under UUIDs. (Optional precise migration key: the
    `croaod.cz/stream/<uuid>` audio id is identical between HTML and API for the same content.)
- **(#4 parts) RESOLVED — supported.** Episodes carry a `part` number and a `serial` relationship
  (id available inline, no extra fetch) plus `mirroredSerial.totalParts`. Group episodes by
  `serial.id`, order by `part` → rebuild the existing multi-part `ScrapedShow`; standalone episodes
  (no serial) → single-media show.
- **(#5 audio) UNCHANGED.** `audioLinks` = `croaod.cz/stream/<uuid>/manifest.mpd` (DASH) + HLS —
  same `kind:"dash"` → ffmpeg path we already use. No codec change.

**Net:** JSON:API ingestion of pohadka is ~4 fast calls (vs hundreds of throttled HTML fetches),
full archive, no 403, with the data to preserve the multi-part model and dedup. Proceed to Phase 2
with JSON:API; the only real work is the episode→ScrapedShow mapper (serial grouping) + a small
cleanup/re-ingest of the existing HTML-era rows.

## (original) Phase 1 — Spike: contract + the two blocking questions (~½–1 day)

Deliverable: a short findings doc answering, per target programme:

1. **Feed id** — the correct podcast-feed UUID for each programme (Hajaja, Pohádka, the cetba/
   wave/junior programmes). The legacy node-id is not it; capture the real id (browser network
   log on `mujrozhlas.cz`, or the page's embedded UUID).
2. **Truncation** — does the feed carry the *full archive* or only recent N? (Determines RSS vs
   JSON:API per programme.)
3. **[BLOCKING] sourceId reconciliation** — does any feed/API surface expose the **legacy Drupal
   node-id**? Cross-source dedup in `repo.ts upsertShow` matches on `shows.sourceId` *alone*
   (no sourceKey filter, lines ~63-70); HTML derives `sourceId` from the URL node-id
   (`cetba/reading.ts readingIdFromUrl`) while RSS uses the feed `guid` (`iradio/rss.ts` ~l85),
   which is a UUID. If the new source emits UUIDs, then: (a) every show **double-ingests** under
   the same key (different sourceId passes the unique index → new row → new acquire → new pin),
   and (b) the **junior↔pohadka mirror-skip breaks** (it relies on a globally shared node-id).
   → Required outcome: confirm the payload exposes the node-id (Drupal often does, e.g.
   `drupal_internal__nid`) and pin `sourceId` to it. **If it can't, this plan needs a one-time
   backfill migration of `shows.sourceId` — a blocking design decision, not a footnote.**
4. **[BLOCKING] part granularity** — HTML produces *one multi-part `ScrapedShow`* per reading
   (`reading.ts` builds `parts[]`; `processors.ts` ~l49-56 branches on `s.parts`). RSS/podcast
   produces *one single-media show per episode*. Decide: regroup feed episodes into multi-part
   shows to match the existing model, or flatten to one-show-per-episode and accept the catalog
   shape change (and the dedup churn it implies). Document the choice.
5. **Audio kind + auth/limits** — mp3 (`kind:"file"`) vs DASH (`kind:"dash"`, ffmpeg); any API
   auth headers; observed rate limits.

**Gate:** do not start Phase 2 until 1–4 are answered. If 3 or 4 force a catalog change/backfill,
re-confirm scope before building.

## Phase 2 — Mapper + (reused) feed client (~½ day if RSS)

- Reuse `parsePodcastFeed`; add a thin per-programme feed walker honoring `ctx.signal`,
  `ctx.maxFetches`, and `onProgress` (same bounding contract as the HTML crawler).
- Episode → `ScrapedShow` mapper that **sets `sourceId` to the legacy node-id** (per Phase-1) and
  applies the Phase-1 part-granularity decision.
- Pick the `limit` default deliberately (HTML uses `1000`; `iradio` uses `50` *per feed* — a
  re-pointed pohadka must not silently truncate to 50).

## Phase 3 — Source strategy + registry (~½ day)

- `makeApiScraper({ key, title, schedule, feeds })` returning a `Scraper`; same `discover`
  contract (progress + bounding) as `makeStationScraper`.
- Re-point `pohadka` first (config swap in `pohadka/index.ts`), keyed by confirmed feed ids.

## Phase 4 — Rollout & cleanup (~½ day)

- Run `pohadka` first; verify full archive, **0×403**, no duplicate rows vs HTML-era, mirror-skip
  intact, bounded time.
- Then junior/cetba/wave. **Keep `station.ts` until ≥1 clean full cycle** — rollback = revert the
  source config swap. Only delete `makeStationScraper` in a *later* phase, never in the cutover.
- Update `docs/PLAN.md` §5/§7.

## Tests

- **Unit fixture test on the mapper:** captured feed → assert `sourceId == legacy node-id`, and
  assert a `junior-pribehy`/`pohadka` overlap still triggers the mirror-skip. This is where the
  silent breakage lives, so guard it at unit level (don't rely only on integration runs).
- `parsePodcastFeed` fixture test if not already present.

## Risks & open questions

- **Endpoint/auth unknown** → RSS-first + spike gate mitigates; RSS is the realistic plan-B if the
  episode XHR can't be captured.
- **sourceId namespace mismatch (node-id vs UUID)** → blocking; resolved in Phase 1 or via backfill.
- **Part-granularity / catalog reshape** → blocking design decision in Phase 1.
- **Audio codec change on re-ingest** → if content arrives as mp3 vs the HTML `dash`, mismatched
  `sourceId` would also re-acquire + re-pin under a different codec (wasted IPFS). Same root cause
  as dedup; fixed by the node-id pinning.
- **RSS truncation** → per-programme escalation to JSON:API only where confirmed.
- **`limit` semantics** → set deliberately for the API scraper.

## Out of scope

- acquire/ipfs/index stages (unchanged — only discovery changes).
- `iradio` (already feed-based; modernize its feed URLs only if convenient).

## Acceptance

- `pohadka` ingests the full Hajaja + Pohádka archives in one bounded run, **0×403**, 0 unrelated
  leakage, **0 duplicate shows vs HTML-era rows**, mirror-skip with `junior-pribehy` intact.
- Re-runs idempotent (already-pinned short-circuit — gated on correct `sourceId`).
- `scrape_runs` shows `discovered ≈ archive size, failed 0`; progress visible via `updateProgress`;
  terminates well under the watchdog.
