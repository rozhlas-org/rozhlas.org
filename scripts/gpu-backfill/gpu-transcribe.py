#!/usr/bin/env python3
"""GPU backfill runner — transcribe a worklist with faster-whisper large-v3.

Runs on a rented (vast.ai) GPU. Reads worklist.jsonl, fetches each file from the
public IPFS gateway (bounded concurrency so it doesn't hammer our single node),
transcribes (batched, int8), and writes out/<audioFileId>.json atomically.
Resumable (skips valid existing outputs). No DB, no secrets — just the gateway.

  pip install faster-whisper requests
  python gpu-transcribe.py --worklist worklist.jsonl --out out \
      --model large-v3 --gateway https://ipfs.rozhlas.org \
      --batch 16 --fetch-concurrency 3 --compute int8_float16

Each output: {audioFileId, language, duration, model, segments:[{start,end,text}], text}
"""
import argparse
import json
import os
import queue
import sys
import tempfile
import threading
import time

import requests


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--worklist", required=True)
    p.add_argument("--out", default="out")
    p.add_argument("--model", default="large-v3")
    p.add_argument("--gateway", default="https://ipfs.rozhlas.org")
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--fetch-concurrency", type=int, default=3)
    p.add_argument("--compute", default="int8_float16")  # int8_float16 | float16 | int8
    p.add_argument("--device", default="cuda")
    return p.parse_args()


def load_pending(worklist, outdir):
    """Worklist items whose output doesn't yet exist + parse cleanly."""
    items = []
    with open(worklist) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            it = json.loads(line)
            outp = os.path.join(outdir, f"{it['audioFileId']}.json")
            if os.path.exists(outp):
                try:
                    with open(outp) as g:
                        d = json.load(g)
                    if d.get("segments") is not None:  # valid → done
                        continue
                except Exception:
                    pass  # corrupt → re-do
            items.append(it)
    return items


def fetch_worker(gw, in_q, out_q, tmpdir):
    """Download cid → temp file; hand (item, path) to the GPU. Bounded by pool size."""
    while True:
        it = in_q.get()
        if it is None:
            out_q.put(None)
            in_q.task_done()
            return
        path = os.path.join(tmpdir, f"a{it['audioFileId']}")
        try:
            t0 = time.time()
            r = requests.get(f"{gw}/ipfs/{it['cid']}", timeout=180, stream=True)
            r.raise_for_status()
            with open(path, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
            out_q.put((it, path, time.time() - t0))
        except Exception as e:
            print(f"  fetch FAIL af{it['audioFileId']}: {e}", file=sys.stderr, flush=True)
            out_q.put((it, None, 0.0))
        finally:
            in_q.task_done()


def write_atomic(outdir, audio_file_id, obj):
    fd, tmp = tempfile.mkstemp(dir=outdir, prefix=f".{audio_file_id}.", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(outdir, f"{audio_file_id}.json"))  # atomic


def main():
    a = parse_args()
    os.makedirs(a.out, exist_ok=True)
    pending = load_pending(a.worklist, a.out)
    total_audio = sum(it.get("durationSec") or 0 for it in pending)
    print(f"{len(pending)} pending (~{round(total_audio/3600)} h). loading {a.model}...", flush=True)

    from faster_whisper import WhisperModel, BatchedInferencePipeline

    model = WhisperModel(a.model, device=a.device, compute_type=a.compute)
    batched = BatchedInferencePipeline(model=model)

    # Both queues are bounded so the fetchers can't prefetch the whole worklist
    # to disk ahead of the (slower) GPU — out_q backpressure caps files-on-disk,
    # otherwise a long run fills the box and every fetch dies with Errno 28.
    in_q, out_q = queue.Queue(maxsize=a.fetch_concurrency * 2), queue.Queue(maxsize=a.fetch_concurrency * 2)
    tmpdir = tempfile.mkdtemp(prefix="gpu-tx-")
    pool = [
        threading.Thread(target=fetch_worker, args=(a.gateway, in_q, out_q, tmpdir), daemon=True)
        for _ in range(a.fetch_concurrency)
    ]
    for t in pool:
        t.start()

    def feeder():
        for it in pending:
            in_q.put(it)
        for _ in pool:
            in_q.put(None)

    threading.Thread(target=feeder, daemon=True).start()

    done, fetch_wait, gpu_time, t_start = 0, 0.0, 0.0, time.time()
    finished_workers = 0
    while finished_workers < len(pool):
        item = out_q.get()
        if item is None:
            finished_workers += 1
            continue
        it, path, dl = item
        fetch_wait += dl
        if not path:
            continue
        try:
            g0 = time.time()
            segments, info = batched.transcribe(path, language="cs", batch_size=a.batch)
            segs = [
                {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                for s in segments
                if s.text.strip()
            ]
            gpu_time += time.time() - g0
            write_atomic(
                a.out,
                it["audioFileId"],
                {
                    "audioFileId": it["audioFileId"],
                    "language": info.language,
                    "duration": round(info.duration, 2),
                    "model": f"faster-whisper:{a.model}",
                    "segments": segs,
                    "text": " ".join(s["text"] for s in segs),
                },
            )
            done += 1
            if done % 10 == 0 or done == len(pending):
                el = time.time() - t_start
                aud = sum((p.get("durationSec") or 0) for p in pending[:done])  # rough
                print(
                    f"  {done}/{len(pending)} | wall {round(el)}s | gpu {round(gpu_time)}s "
                    f"| fetch {round(fetch_wait)}s | RTF~{round(gpu_time and aud/gpu_time,1)}x",
                    flush=True,
                )
        except Exception as e:
            print(f"  transcribe FAIL af{it['audioFileId']}: {e}", file=sys.stderr, flush=True)
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    el = time.time() - t_start
    print(
        f"\nDONE {done}/{len(pending)} in {round(el)}s | gpu {round(gpu_time)}s | fetch {round(fetch_wait)}s"
        f"\n→ {'FETCH-BOUND (RTF is I/O-limited)' if fetch_wait > gpu_time else 'compute-bound (good)'}",
        flush=True,
    )


if __name__ == "__main__":
    main()
