# Analysis: transcribe the archive, store + semantically search transcripts

> Planning/analysis only — no implementation. Branch `feat/transcripts` (own worktree).
> Goal: transcribe the audio with a **local model** (avoid per-item API cost), store transcripts
> in the DB, embed them via **Voyage** for semantic search + filtering. Question on the table:
> data-size estimates, and whether "huge DB indexes" are a problem.

## The real workload (measured, not the 800 GB headline)

| Metric | Value (from the prod DB) |
|---|---|
| Audio files (total) | 20,462 |
| Pinned & streamable (transcribable now) | **12,925** |
| Files with known duration | 14,405 |
| **Total audio** | **~7,300 hours** (≈ 543 GB measured, trending to ~800 GB) |
| Avg file | 30 min / 42 MB |
| Shows | 15,687 |

**Hours, not gigabytes, is the metric that drives every estimate below.** ~7,300 h today, growing.

## The hardware (the binding constraint)

| | |
|---|---|
| CPU | **Intel i7-6700** — 4 cores / 8 threads, 3.4 GHz, AVX2, **no AVX-512** |
| GPU | **none** |
| RAM | 62 GB |
| Disk | 2 TB, 1.4 TB free |

This is a 2015 desktop CPU also running the scraper, worker, IPFS, Ollama and the API.

---

## 1. Transcription compute — this is the entire problem

Everything downstream (DB, FTS, embeddings, search) is cheap and easy. **Transcription is the only
hard, expensive part**, and on this box it is the wall.

### Local Whisper throughput on the i7-6700 (faster-whisper / CTranslate2, int8, 8 threads)

**MEASURED (2026-06-20)** — large-v3 int8, 8 threads, on a real 6-min Czech clip from our archive:
- **0.89× realtime** (transcribing 6 min took 6.7 min), model load 39 s one-time, lang=cs p=1.00.
- Czech quality is **good** — faithfully captured a bilingual CZ/SK broadcast incl. proper nouns.
- → **~21 audio-hours/day** max on this box; **~342 days** to backfill 7,300 h (all cores, box idle).

| Model | Czech quality | Realtime factor | **Wall-clock for 7,300 h (all cores, box idle)** |
|---|---|---|---|
| large-v3 | best | **0.89× (measured)** | **~342 days** |
| medium | good | ~2× (est) | ~150 days |
| large-v3-turbo / distil | slightly below large | ~2–3× (est) | ~100–150 days |
| small | mediocre (Czech suffers) | ~4× (est) | ~75 days |

**Verdict (confirmed by benchmark):**
- **Backfill on CPU = ~342 days → infeasible.** Needs rented GPU (~$150) or Groq (~$300).
- **Steady-state on CPU = viable.** Capacity ~21 audio-h/day ≫ new content (~a few h/day from the
  daily scrapers), so the box keeps up with new shows easily — even throttled/`nice`d to ~4 threads
  (~12 h/day) it stays ahead, leaving CPU for the scraper/worker/IPFS/web.

**Conclusion: a one-time CPU backfill of the archive is infeasible** — months of pinning all cores,
starving the rest of the stack, for the only model size (medium/large) that does Czech justice.
CPU is fine for *steady-state* (new shows ≈ a few hours/day ≪ capacity), just not the 7,300 h backfill.

### Options for the **backfill** (decouple it from steady-state)

| Option | Cost | Time | Control | Notes |
|---|---|---|---|---|
| **Rent a cloud GPU, run our own faster-whisper** ⭐ | **~$100–200 one-time** | days–2 wks | full (our model/weights) | large-v3 + batching on an RTX 4090/L4/A10 ≈ 20–40× RT → ~250 GPU-h. runpod/vast ~$0.35–0.7/h, or a Hetzner GPU box for ~2 weeks. Closest to "local model, no per-item pricing." |
| **Cheap batch API (Groq whisper-large-v3-turbo)** | **~$300** | hours–days | none (their infra) | $0.04/audio-h, large-v3 quality, massive parallelism. It *is* an API, but $300 one-time ≪ months of compute. |
| Other APIs (OpenAI $0.36/h, Deepgram ~$0.26/h) | $1,900–2,600 | fast | none | Far pricier than Groq for the same job. |
| **CPU on this box, steady-state only** | $0 | n/a for backfill | full | Transcribe new shows as they arrive; **skip the backfill** or do it slowly over many months. |
| Buy/add a GPU to the server | capex | — | full | Overkill unless this becomes ongoing heavy use. |

**The "free local model" goal collides with hardware reality:** free *and* this corpus *and* this box
= many months. Pick two. The pragmatic read: **rent a GPU for the one-time backfill (~$150), keep
local CPU for the steady-state trickle.** Groq (~$300) is the zero-infra alternative.

### Model choice
- **faster-whisper** (CTranslate2) — fastest CPU/GPU Whisper, int8 quantization, batching. Preferred.
- For Czech: **large-v3** (or `large-v3-turbo` / distil for speed). medium is the floor for acceptable
  Czech; small/base mangle diacritics and names.
- Word-level timestamps + optional diarization via **WhisperX** (heavier; decide per §3).

---

## 2. Data-size estimates

Spoken Czech ≈ 140 wpm → ~8,400 words/h. 7,300 h ≈ **61 M words ≈ ~85 M tokens**.

| Artifact | Estimate | Notes |
|---|---|---|
| Raw transcript text | **~0.4 GB** | UTF-8 Czech ~6.5 B/word |
| + segment timestamps (JSON: start/end/text per ~5–10 s) | **~1–1.5 GB total** | what we'd store |
| Word-level timestamps (if enabled) | ~5–8 GB | only if we want second-precise deep-links |
| FTS5 index over transcripts | ~0.5–1 GB | inverted index, ~0.5–1× text |
| Embedding chunks (~512 tok, ~20% overlap) | **~250k chunks** | |
| Embeddings storage (1024-dim) | ~1.0 GB float32 / **~256 MB int8** | sqlite-vec |
| **Total added to SQLite** | **~3–5 GB** | DB is 64 MB today |

All well within SQLite's comfort zone (it handles tens of GB).

---

## 3. Voyage embeddings — how, and the cost

- **Chunk** each transcript into ~400–512-token windows (with ~15–20% overlap and timestamps), so a
  hit can deep-link to the moment in the audio.
- **Embed** chunks with Voyage (we already use Voyage + `sqlite-vec` for show-level omnisearch — same
  path, new table). voyage-3.5 / voyage-3-large, 1024-dim.
- **Cost is negligible** — the opposite of transcription:
  - ~85 M tokens × ~1.2 (overlap) ≈ **~100 M tokens**.
  - voyage-3.5-lite @ $0.02/1M → **~$2**; voyage-3-large @ $0.18/1M → **~$18**.
- **Store** in `sqlite-vec` (+ keep chunk text for FTS + display). int8 quantization halves/quarters
  the vector storage with minimal recall loss.

So: **transcription is ~$150–300; embeddings are ~$2–20.** The cost worry is entirely on the audio side.

---

## 4. "Huge DB indexes — problem or not?"

**Not a problem at this scale.** Concretely:
- FTS5 over ~1 GB of text and **vector search over ~250k chunks** are small for SQLite. Brute-force
  `sqlite-vec` over 250k × 1024-dim ≈ ~50–150 ms/query — fine.
- Total DB ~3–5 GB. SQLite is happy into the tens of GB; row counts (15k shows, 250k chunks) are tiny.
- **Watch-items, not blockers:**
  - **Vector search > ~1 M chunks** (future growth): brute-force gets slow → move to `sqlite-vec`
    ANN/partitioning or a dedicated vector store. We're 4× under that now.
  - **Single-file growth**: VACUUM time, WAL checkpoints, backup size. Mitigate by putting transcripts
    + chunks + vectors in a **separate ATTACHed SQLite DB** so the hot app DB stays 64 MB and snappy,
    and the big append-mostly transcript DB is backed up on its own cadence. (Recommended.)
  - **Combined filter + semantic search**: pre-filter by metadata (programme/station/date) then vector
    search the subset — `sqlite-vec` supports partition/aux columns + rowid constraints; or filter via
    SQL JOIN. This is a design detail, not a scaling risk.

---

## 5. Pipeline shape (for the future build — not now)

```
ipfs-verify ──▶ transcribe ──▶ embed-transcript ──▶ index
                  │                 │
   download CID→temp,          chunk + Voyage embed,
   faster-whisper,             store sqlite-vec + FTS,
   store text+segments,        (timestamps per chunk)
   delete temp                 
```
- Mirrors the **artwork** job we just shipped: a scheduled drain (`transcribe`) finds pinned audio
  without a transcript, pulls it by CID from the internal gateway, runs the model, stores, deletes the
  temp (audio never kept on disk). Backfill = a one-off GPU/Groq batch whose JSON we import.
- **Schema (new):**
  - `transcripts(id, audioFileId, showId, lang, model, text, segmentsJson, createdAt)`
  - `transcript_chunks(id, transcriptId, showId, idx, startSec, endSec, text, embedding)`
  - FTS5 virtual table over `transcript_chunks.text` (accent-insensitive, like the existing one)
  - `sqlite-vec` vec table for chunk embeddings
- **Payoff:** search *inside* the spoken content, filter by programme/station/date, and **deep-link a
  result to the exact second** in the player — a feature the show-level metadata can't give.

## 6. Recommended phasing
0. **Benchmark first** (½ day): install faster-whisper on this box, transcribe 3–5 real files at
   small/medium/large, measure the true realtime factor + Czech quality on our actual audio. Validates
   every number above before committing.
1. **Schema + steady-state stage**: `transcribe` + `embed-transcript` jobs (CPU, local), wired for new
   shows. Search UI over transcript chunks (FTS + vector + filter + timestamp deep-link).
2. **Backfill**: rent a GPU (or Groq) for the ~7,300 h one-time run; import results.
3. **Scale watch**: separate transcripts DB; revisit ANN if chunks approach ~1 M.

## Open decisions (need your call)
- **Backfill compute:** rent-GPU (~$150, local model) / Groq (~$300, API) / CPU-steady-state-only (free, no backfill).
- **Model/quality:** large-v3 (best Czech) vs medium (2× faster, "good enough").
- **Timestamp granularity:** segment-level (~1.5 GB) vs word-level (~5–8 GB, second-precise deep-links).
- **DB layout:** single DB vs separate attached transcripts DB (recommended).
