# Plan: backfill transcripts for the whole archive (affordable, rigorous)

> Steady-state (new shows) already transcribes on the box. This is the **one-time historical
> backfill** of everything already pinned — the ~year-long CPU grind we deliberately deferred.
> Goal: cheapest viable way to transcribe the lot at acceptable Czech quality.

## Scope (measured 2026-06, growing)
- **~12,440 h** of audio · **22,746 files** · avg **33 min/file** · all pinned + streamable on our IPFS.
- Source bytes ≈ ~370 GB (served from our gateway by CID). Corpus still grows as scrapers add sources
  (#76 added 3 mujRozhlas sources with transcription off for bulk load).

## Cost landscape (computed for 12,440 h, 2026 rates)

| Option | Quality | Unit rate | **Total** | Wall time | Ops |
|---|---|---|---|---|---|
| **Self-run RTX 4090 spot** (our faster-whisper) | **full large-v3** | ~$0.29/GPU-h, 40–70× RT | **~$55–120** | 2–13 days (scale w/ #GPUs) | High |
| **Groq free tier** (large-v3-**turbo**) | turbo | $0 (2,000 req/day) | **$0** | ~12 days | Low |
| Groq paid (turbo) | turbo | $0.04/audio-h | ~$500 | hours–days | Low |
| Groq paid (full large-v3) | full | ~$0.11/audio-h | ~$1,380 | hours–days | Low |
| Deepgram Nova-3 batch | own | $0.216/audio-h | ~$2,690 | — | Low |
| AssemblyAI Universal | own | $0.222/audio-h | ~$2,760 | — | Low |
| OpenAI whisper/gpt-4o-transcribe | own | $0.36/audio-h | ~$4,480 | — | Low |

Everything below Groq is 5–40× pricier and not own-model — eliminated. **Two real contenders:**

### A. Self-run faster-whisper on a rented spot GPU — ~$100–220 (most likely ~$150), full large-v3
- **Corrected estimate** (earlier $55–120 used an optimistic 40–70× RTF). Real-world sustained
  batched/INT8 large-v3 is **~15–30× realtime**; credible cited figure: **L40S spot $0.32/h @ 20× →
  ~$0.016/audio-h**. Cost-optimal: **RTX 3090 or L40S spot** (fits in 24 GB, cheap/h).
  - RTX 3090 @ Clore/vast ($0.10–0.22/h, ~15–20×) → ~$0.005–0.013/audio-h → **~$65–165**.
  - + **~370 GB audio download** to the box (vast/Clore bill per-GB, host-set: **~$0–40** — pick a
    free/cheap-bandwidth host). **All-in ~$100–220.**
- Cheapest providers: **Clore.ai** (40–60% under RunPod; 3090 spot floor ~$0.03/h) and **vast.ai**.
- **Best quality** (full large-v3 — matters for literary Czech: poetry, proper nouns, names) and our
  own model/control. Cheapest by far.
- **Engineering (the cost is here, not the $):**
  1. Provision a 4090 box; install faster-whisper + `BatchedInferencePipeline` (batch_size 16, fp16).
  2. Feed it a worklist of `(audioFileId, cid)` (export from our DB). Worker pulls each by CID from
     `https://ipfs.rozhlas.org/ipfs/<cid>`, transcribes, writes `{audioFileId, lang, segments, text}` JSON.
  3. **Resilience:** spot instances get reclaimed — checkpoint per-file (skip already-done via an output
     manifest), so a kill just resumes. Idempotent worklist.
  4. **Import:** a one-off script reads the JSON outputs → `saveTranscript()` + enqueue `embed-transcript`
     (reuse the existing pipeline; FTS auto-indexes on insert). Voyage embeds ~$2–18 total.
  - Parallelism is free on cost (GPU-h is GPU-h): 1×4090 ≈ ~7–13 days; 4×4090 ≈ ~2 days; same ~$60–120.

### B. Groq API (large-v3-turbo) — $0 (but ~8.6 months) or ~$250–500 paid
- **Free tier includes FULL large-v3** (both whisper models, no card) — same quality as paid/self-run;
  free vs paid differs only in rate limit. So **$0 + full large-v3 is a real path.**
- **Free tier binding constraint:** 7,200 **audio-seconds/hour** = 2 audio-h per clock-h = **48 audio-h/day**
  → 12,440 h ÷ 48 = **~259 days (~8.6 months)**. $0 + full quality, but a slow background trickle, and
  sustained 24/7 bulk use for 8+ months may trip free-tier ToS/throttling (not guaranteed).
- **Developer tier = add a credit card = pay-as-you-go** (not free): 10× limits (~480 audio-h/day → ~26
  days) + 25% discount, but you pay **$0.04/audio-h (turbo) → ~$500**, or **~$0.111/h (full large-v3) →
  ~$1,380**. The **Batch API halves rates → ~$250 (turbo)** with ~24 h windows. There is **no free path
  with higher limits.**
- **Tradeoffs:** (1) it's **turbo**, a distilled large-v3 — slightly lower accuracy on hard audio /
  proper nouns / non-English; for a literary archive that's a real (if modest) quality hit vs full
  large-v3. (2) Free-tier bulk use depends on rate limits + ToS holding; treat $0 as best-effort, not
  guaranteed. (3) Audio leaves our infra (sent to Groq).
- **Engineering (low):** a script POSTs each file's bytes (or a presigned/gateway URL) to Groq, parses
  the verbose-JSON segments, imports via `saveTranscript()` + embed. Handle 429s + the daily cap.

## Recommendation
- **Best value: A (self-run RTX 4090 spot).** ~$60, **full large-v3** quality the content deserves, our
  model, our data stays on our infra. The only cost is a few hours of setup (scriptable with AI help) +
  resume-on-interrupt. Run 1 GPU over a week, or 4 GPUs over ~2 days — same money.
- **If turbo quality is acceptable and you want zero infra:** B paid (~$500, done in a day) — or B free
  ($0, ~12 days) if you're patient and accept free-tier uncertainty.
- **Not worth it:** Deepgram/AssemblyAI/OpenAI — 5–40× the cost for no quality win over our own large-v3.

## Cross-cutting
- **Import path is identical** for A and B: produce per-file `{segments,text,lang}` → `saveTranscript()`
  (chunks + FTS auto) → `embed-transcript` (Voyage). Embeddings ~$2–18 regardless.
- **Don't double-transcribe:** worklist = files with a CID and no transcript row; steady-state keeps
  running on the box meanwhile (skip-if-exists guards both).
- **Corpus grows:** re-run the worklist export before launching; new scraper sources keep adding hours.
- **Voyage rate limits:** 250k+ chunks to embed — batch within the embed job; one-time ~$2–18.

## Open decision
Pick the lane: **A self-run GPU (~$60, full large-v3)** / **B Groq paid (~$500, turbo, zero ops)** /
**B Groq free ($0, ~12 days, turbo)**. Then I build the worklist export + transcribe runner + importer.
