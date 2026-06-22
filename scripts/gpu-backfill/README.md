# GPU transcript backfill (vast.ai) — runbook

One-time historical backfill of the untranscribed archive with our own faster-whisper
large-v3 on a rented spot GPU. Off-system, idempotent, reuses the live import pipeline.
Plan + cost analysis: `docs/plans/gpu-backfill.md`.

```
 OUR BOX                         VAST GPU (spot)                    OUR BOX (worker container)
 export-worklist.ts  ──scp──▶    gpu-transcribe.py     ──rsync──▶   import-results.ts
   worklist.jsonl                  out/<id>.json                     → saveTranscript + embed
```

## 0. PROBE FIRST (de-risk the cost before the full run)

On our box — a small, duration-mixed, newest-first sample:
```bash
bun run scripts/gpu-backfill/export-worklist.ts --limit 40 --out probe.jsonl
```

Rent ONE cheap spot GPU on vast.ai (try **RTX 3090** first; it fits large-v3 in 24 GB and is the
cheapest $/audio-hour). Pick a host with **cheap/free bandwidth** and ~50 GB disk. Then on the GPU box:
```bash
pip install -q faster-whisper requests
# copy probe.jsonl + gpu-transcribe.py up first (scp), then:
python gpu-transcribe.py --worklist probe.jsonl --out out --model large-v3 \
    --gateway https://ipfs.rozhlas.org --batch 16 --fetch-concurrency 3 --compute int8_float16
```
Read the final line: **RTF**, **gpu vs fetch time** (compute-bound = good; fetch-bound = our gateway is
the limit), wall-clock. Compute **$/audio-hour = (instance $/hr) ÷ RTF**, then full-run = `13,862 × that`.
Optionally re-run 5 files with `--model large-v3-turbo` to compare speed/quality.

Bring the results back and import (validates the whole round-trip + embeddings):
```bash
rsync -avz <gpu>:out/ ./data/gpu-out/         # on our box
docker compose exec worker bun run /app/scripts/gpu-backfill/import-results.ts --dir /data/gpu-out
```
Spot-check a few transcripts on the site vs the Groq ones. **Decision gate:** firm cost + chosen
GPU/model → green-light the full run, or fall back to Groq Batch (~$250–690, zero ops).

## 1. FULL RUN (after the probe)

```bash
bun run scripts/gpu-backfill/export-worklist.ts --out worklist.jsonl   # re-export (corpus grows)
```
Rent the chosen GPU (or N of them — cost is GPU-hours either way; split the worklist with
`split -n l/4 worklist.jsonl` for 4 boxes). On each:
```bash
python gpu-transcribe.py --worklist worklist.jsonl --out out --model large-v3 \
    --gateway https://ipfs.rozhlas.org --batch 16 --fetch-concurrency 3 --compute int8_float16
```
**Sync continuously** (spot boxes get reclaimed — don't wait for the end):
```bash
while true; do rsync -az <gpu>:out/ ./data/gpu-out/; sleep 300; done
```
Import is resumable — run it any time, repeatedly:
```bash
docker compose exec worker bun run /app/scripts/gpu-backfill/import-results.ts --dir /data/gpu-out
```
When the worklist is drained, **destroy the instance** (don't leave it idle).

## Notes
- **Resumable everywhere:** the runner skips valid `out/<id>.json`; the importer skips
  `transcriptExists`. A reclaimed box loses at most the in-flight file (atomic writes + periodic sync).
- **No secrets on the GPU box** — only the public gateway + worklist. Don't put `.env` there.
- **Gateway courtesy:** `--fetch-concurrency` caps load on our single Kubo node (shared with users).
  If the probe shows fetch-bound, raise prefetch or stand up a second gateway before the full run.
- **Groq steady-state keeps running** during all this — different scope, `transcriptExists` dedupes.
