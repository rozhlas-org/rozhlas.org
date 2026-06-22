# Plan: transcript backfill on a rented GPU (vast.ai, cost-first)

> The Groq free tier is **8 audio-h/day** (28,800 ASPD), so the **13,862 h** backlog would take
> ~4.7 years and never catches up with growth. Groq free stays for **steady-state** (new shows fit
> under 8 h/day, newest-first). This plan does the **one-time historical backfill** on a rented spot
> GPU with our own faster-whisper large-v3 — cheapest path, full quality, data on our infra.

## Scope (measured, growing)
- **30,101 untranscribed files · ~13,862 h · ~984 GB originals.** Grows as scrapers add sources.
- Re-export the worklist right before the real run (and the probe is on live data).

## Architecture — 3 small pieces, our pipeline unchanged
```
 OUR BOX (i7)                        VAST GPU (spot, ephemeral)              OUR BOX
 export-worklist.ts                  gpu-transcribe.py                      import-results.ts
   query untranscribed   ──jsonl──▶    for each {id,cid}:           ──json──▶ for each output:
   {audioFileId, cid,                    fetch cid from                         transcriptExists? skip
    durationSec}                         ipfs.rozhlas.org (public gw)           else saveTranscript()
   newest-first                          faster-whisper large-v3 (batched,       + chunkSegments
                                         int8) → {lang,segments,text}           + enqueue embed-transcript
                                         write out/<id>.json (resumable)        (REUSES existing pipeline)
```
- **No DB access from the GPU box** — it only needs the worklist file + the public IPFS gateway. Keeps
  the GPU box dumb/disposable and our DB private.
- **Audio source:** `https://ipfs.rozhlas.org/ipfs/<cid>`. faster-whisper resamples to 16 kHz internally,
  so **no transcode needed** on the GPU side (unlike Groq's 25 MB cap).
- **Results back:** GPU box writes `out/<id>.json` (~1.5 GB total); we `rsync`/pull them and import.
- **Import reuses the running pipeline:** `saveTranscript()` (FTS auto) → `embed-transcript` (Voyage),
  idempotent via `transcriptExists()` + the unique `audioFileId` (no clash with the Groq steady-state).

## Cost optimization (the priority)
`cost = (audio-hours ÷ RTF) × $/GPU-hr + bandwidth`. Levers, biggest first:
1. **GPU = cheapest $/audio-hour**, not cheapest $/hr. Probe RTX 3090 ($0.13–0.22/h) vs 4090
   ($0.29–0.39/h) vs L40S ($0.32) and pick the lowest **$/hr ÷ RTF**. (3090 usually wins on $/audio-h.)
2. **Spot/interruptible** (50–80% off on-demand) — requires resumable worklist (we have it).
3. **Batched inference** (`BatchedInferencePipeline`, batch_size 16–24) — the single biggest RTF lever.
4. **int8 quantization** — ~30 % faster, negligible WER loss.
5. **Bandwidth:** pick a **free/cheap-bandwidth host** (vast hosts set their own). 984 GB ingress at
   $0–0.05/GB = $0–50. If a host charges, fall back to pre-transcoding to opus on our box (984→~120 GB).
6. **Destroy on completion** — never leave the instance idle; size disk to ~50 GB (no model/audio kept).
7. **Quality/cost knob:** `large-v3-turbo` is ~2–4× faster (≈half cost) at slightly lower Czech WER —
   the probe transcribes a few files with both so you can choose with eyes open.
8. **Parallelism is cost-neutral** (GPU-hours are GPU-hours): 1 GPU over days vs 4 over hours = same $.

**Estimate (firm up via probe): ~$120–270 GPU + ~$0–4 embeddings.** voyage-4-lite is $0.02/1M with
200 M free tokens; ~13,862 h ≈ ~150 M tokens ≈ **$0–4** (negligible — embed *throughput* over ~465 k
chunks via Voyage's rate limits is the only real cost, and it's free + background). The GPU ±band is
entirely RTF — hence the probe.

### Cost vs ops (eng-review): why vast over the alternatives
- **Serverless GPU (Modal/Runpod-serverless): ~$400–600** — their GPUs are 3–8× spot $/hr, so "no box
  management" costs ~3–4×. Not same-cost.
- **Groq Batch: ~$250–690, zero ops, zero interruption risk.** The honest trade for vast (~$150) is
  ~$100–500 for "no babysitting." We keep vast for cost, but the scripts below are substrate-agnostic
  (the Python runner is identical on Modal/Runpod if we ever flip).

### Gateway is a shared, single-node bottleneck — treat it as one
984 GB egresses our *one* Kubo node through Caddy, shared with real users. The runner therefore:
- **Caps fetch concurrency** (`--fetch-concurrency`, default 3) + prefetches a few files ahead so the
  GPU isn't fetch-starved but the node isn't hammered.
- The probe **logs fetch wait vs GPU time** so we know if RTF is compute- or I/O-bound (an I/O-bound
  probe RTF is a lie). If fetch-bound, options: more prefetch, a second gateway, or pre-stage opus.

## The probe (do FIRST, before the full run)
1. `export-worklist.ts --limit 40` → a 40-file (~22 h) sample, mixed durations, newest-first.
2. Rent ONE cheap spot GPU (3090 first). Install faster-whisper. Run `gpu-transcribe.py` on the sample.
3. **Measure:** wall-clock, **realtime factor**, **$/audio-hour**, **fetch-wait vs GPU-time** (is it
   compute- or gateway-bound?), Czech quality (spot-check vs Groq), and turbo-vs-large-v3 on ~5 files.
   **Import the results** (exercises the embed round-trip + Voyage rate limits, not just compute).
4. **Output:** a firm full-run quote (cost + wall-time), the chosen GPU/model, and whether we're
   fetch-bound. Then decide the real run.

## GSTACK REVIEW REPORT
| Review | Status | Findings |
|---|---|---|
| Eng Review (plan) | ISSUES RESOLVED | 4 folded: embed cost priced (~$0–4, voyage-4-lite 200M free); gateway fetch-concurrency cap + fetch-bound probe metric; atomic-write + validity-check + periodic-sync resumability; probe exercises gateway + embed, not just RTF |
| Outside voice (Claude) | NOTED | "Reconsider: serverless/Batch." Rebutted on cost (serverless ~3–8× spot $/hr → ~$400–600; embeds ~$0–4 not large). Kept vast for cost; scripts substrate-agnostic so flip-to-Modal/Batch is cheap. |

**VERDICT: ENG REVIEW CLEARED — build the 3 scripts + probe.** Cost-first → vast spot (~$150);
Groq Batch (~$250–690) remains the zero-ops fallback. NO UNRESOLVED DECISIONS.

## Scripts to build
- `scripts/gpu-backfill/export-worklist.ts` (our box) — `[--limit N]`, writes `worklist.jsonl`.
- `scripts/gpu-backfill/gpu-transcribe.py` (vast) — batched faster-whisper, resumable, progress, retries.
- `scripts/gpu-backfill/import-results.ts` (our box) — JSON → `saveTranscript` + embed, idempotent.
- `scripts/gpu-backfill/README.md` — exact vast.ai provisioning + run + sync commands.

## Resilience / safety (hardened per eng-review)
- **Atomic outputs:** write `out/.<id>.json.tmp` then `rename` → `out/<id>.json`. A SIGKILL mid-write
  never leaves a half-file that reads back as "done."
- **Validity check on import:** parse + require non-empty segments; a corrupt/empty output is re-queued,
  not silently stored. "exists" alone is not "done."
- **Periodic sync, not end-of-run:** rsync `out/` to our box every N min (or the runner POSTs each result
  as it finishes) so a reclaimed spot box loses at most the in-flight file, not the batch.
- **Spot interruption:** worklist + synced `out/` manifest = checkpoint; restart skips completed ids.
- **Idempotent import:** `transcriptExists()` guard — safe to re-import, safe alongside Groq steady-state.
- **No secrets on the GPU box** (no DB, no API keys; only the public gateway + the worklist file).

## Open questions (for eng review)
- GPU box transcode of long files: any >100 MB / multi-hour edge cases for faster-whisper batching?
- Results transport: rsync pull vs the GPU box POSTing to a small endpoint on our box?
- Run the worklist newest-first (so freshest first) or by-source/size for batching efficiency?
- Keep Groq steady-state running during the GPU backfill (yes — different scopes, idempotent), confirm.
