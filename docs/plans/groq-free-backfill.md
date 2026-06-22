# Plan: Groq free-tier transcript backfill (newest-first, $0, long-running)

> Decision (from `transcript-backfill.md`): backfill the ~12,440 h archive with **Groq free tier,
> full Whisper large-v3** — $0, full quality, as a continuous background trickle. Process **newest
> broadcast first, working back in time**, matching the main page's default order.

## Goal & shape
- **$0**, full large-v3, runs for ~**8.6 months** at the free-tier ceiling (48 audio-h/day).
- **Order: `publishedAt DESC` (NULLs last)** — *identical* to the main page's "Nejnovější" sort
  (`orderForSort("added")` = `desc(publishedAt), desc(createdAt), desc(id)`), so the freshest readings
  become searchable first and it walks back through the archive's timeline.
- **Idempotent / resumable:** the DB is the checkpoint. The producer selects pinned audio with a CID
  and **no transcript row**; restarts just continue. No separate state.

## Hard constraints (verified)
1. **Rate limit (org-level, both whisper models): 7,200 audio-seconds/hour** = 48 audio-h/day. Must
   self-throttle to avoid 429s. (Also 2,000 req/day, but audio-seconds bind first.)
2. **Free-tier upload limit: 25 MB** (dev 100 MB). Our files avg **42 MB**, and Groq **silently fails
   >30 MB**. → **Transcode to 16 kHz mono before upload** (ffmpeg, already in the worker): a 33-min
   reading → ~6 MB Opus/FLAC. Whisper resamples to 16 kHz internally anyway, so no quality loss.
   - Multi-hour outliers (audiobooks): even 16 kHz mono can exceed 25 MB past ~2.5 h → **chunk** those
     (overlapping windows, offset the segment timestamps on import) or defer them to a paid burst.
3. **Free-tier ToS:** sustained 24/7 bulk for 8+ months may be throttled/flagged — treat as best-effort;
   design must degrade gracefully (pause, not crash) and be trivially switchable to a paid burst later.

## Architecture (single self-pacing consumer — simplified per eng review)
A **single, concurrency-1 repeatable job `groq-backfill-tick`** (every ~1 min) that processes **one file
per invocation**, self-pacing against the rate limit — *no* producer/consumer split, *no* Redis budget
window, *no* race (the rate, not parallelism, is the ceiling):
```
groq-backfill-tick (repeatable, concurrency 1):
  1. heartbeat (write last-tick ts)                       ── dead-man's-switch reads this
  2. rate gate: audio-seconds used in the last 60 min ≥ cap?  → skip this tick (try next minute)
  3. keyset cursor: SELECT 1 untranscribed pinned audio
       ORDER BY publishedAt DESC, id DESC  (indexed)       ── newest broadcast first
  4. fetch by CID (internal gateway) → ffmpeg 16 kHz mono opus (≤24 MB; skip if still >24 MB → defer)
  5. POST Groq /audio/transcriptions (whisper-large-v3, language=cs, response_format=verbose_json)
  6. storeTranscription(audioFileId, showId, result)       ── SHARED with the local path (see DRY)
  7. record audio-seconds used (for the rate gate)
```
- **`storeTranscription()` is shared** by the local and Groq paths: `chunkSegments()` → `saveTranscript()`
  (FTS auto) → enqueue `embed-transcript`. (Refactor: extract from the current local `transcribe`
  processor.) Import path is therefore identical and already proven.
- **Rate gate** = sum of `durationSec` of files completed in the trailing 60 min (a tiny in-memory/Redis
  list of `(ts, seconds)`), held under `GROQ_AUDIO_SECONDS_PER_HOUR` (7,000, safety margin under 7,200).
  Concurrency 1 ⇒ no reservation race. ~one ~33-min file every ~17 min ⇒ ~48 audio-h/day.
- **Observability / dead-man's-switch:** heartbeat each tick + a daily check "transcripts created in last
  24 h"; if 0 while the backlog is non-empty → log error / surface in `/admin` (a stall must be visible,
  not silent for weeks). Easy **flip-to-paid:** the same consumer can point at the Batch API by config.
- **Local steady-state stays ON during the probe (Phase 1–2); turned OFF only after Groq is proven
  (Phase 3)** — see phasing. Until then, `transcriptExists()` + the unique `transcripts.audioFileId`
  prevent any double-write if both touch the same newest row.

## Config (new)
- `GROQ_API_KEY` (.env), `GROQ_STT_MODEL=whisper-large-v3`, `GROQ_BASE_URL`.
- `GROQ_BACKFILL_ENABLED` (gate), `GROQ_AUDIO_SECONDS_PER_HOUR=7000` (under 7,200 for safety),
  `GROQ_CONCURRENCY=2`, `GROQ_MAX_UPLOAD_MB=24`.

## Failure modes & handling
- **429 / rate exceeded:** back off + return the job to wait; the budgeter should prevent most. Never
  hammer.
- **Silent fail >30 MB / empty result:** validate the response has segments + non-empty text; if empty,
  fail the job (retry) — but the transcode step should keep everything ≤24 MB so this shouldn't fire.
- **Groq down / ToS throttle (sustained 401/403/persistent 429):** the tick detects a stall and **pauses**
  (logs, stops enqueuing) rather than burning retries; resumes next tick. Switch to paid by flipping a
  flag.
- **Audio fetch fails (CID/gateway):** retry; skip after N attempts (don't block the queue).
- **Duplicate guard:** `transcriptExists(audioFileId)` before submit (race-safe via the unique
  `transcripts.audioFileId`).

## Phasing (probe before cutover — per decision)
1. **Provider + shared store** — `groqTranscribe(url)` in media (fetch → ffmpeg 16 kHz mono opus → POST
   → parse verbose_json). Extract `storeTranscription()` shared by local + Groq. Index on
   `shows.publishedAt`. Unit-test: segment mapping, size/transcode guard, rate-gate math.
2. **Paced consumer + PROBE** — `groq-backfill-tick` (concurrency 1, self-pacing, heartbeat). Enable it
   with **local steady-state still ON.** Probe: confirm real Groq large-v3 transcripts land, newest-first,
   under the rate limit, with no 429s, over a few days. Validate quality on real Czech readings.
3. **Cutover** — once Groq is proven reliable: **turn local CPU transcription OFF** (Groq newest-first
   covers new + backlog), and let it run. Watch the dead-man's-switch; flip to paid Batch if it stalls.

## Resolved (was: open questions)
- **Local steady-state:** OFF — but only in **Phase 3, after the Groq probe passes** (keep it on as
  belt-and-suspenders during Phases 1–2).
- **Budgeter:** single self-pacing concurrency-1 consumer (no producer/window split) — eng-review simplification.
- **Multi-hour outliers:** **defer for v1** — if 16 kHz mono still > 24 MB, skip (leave untranscribed) and
  log; revisit with chunk-and-stitch or a small paid burst later. Avoids the req/day-vs-audio-sec edge case.
- **NULL publishedAt:** sort last (DESC NULLs-last); undated shows may not be reached in 8.6 mo — acceptable.

## GSTACK REVIEW REPORT
| Review | Status | Findings |
|---|---|---|
| Eng Review (plan) | ISSUES RESOLVED | 5 findings → all folded: budgeter simplified (single paced consumer), local-double-work resolved (off after probe), dead-man's-switch added, `storeTranscription` DRY, publishedAt index + keyset cursor; multi-hour outliers deferred |
| Outside voice (Claude) | NOTED | Verdict "reconsider premise" (8.6-mo free-tier risk vs paid Batch). User reaffirmed free, with dead-man's-switch + flip-to-paid as mitigations. |

**VERDICT: ENG REVIEW CLEARED — ready to implement Phase 1.**
NO UNRESOLVED DECISIONS.
