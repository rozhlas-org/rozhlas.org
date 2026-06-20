#!/usr/bin/env python3
"""Transcribe one audio file with faster-whisper and emit JSON on stdout.

Invoked as a subprocess by the worker (like ffmpeg). Progress/errors go to
stderr; stdout carries ONLY the final JSON so the caller can parse it.

  transcribe.py <audio_path> [model_size] [language]

env: WHISPER_THREADS (default 4), WHISPER_COMPUTE (default int8)
"""
import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: transcribe.py <audio_path> [model] [lang]", file=sys.stderr)
        return 2
    audio = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "large-v3"
    lang = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    threads = int(os.environ.get("WHISPER_THREADS", "4"))
    compute = os.environ.get("WHISPER_COMPUTE", "int8")

    from faster_whisper import WhisperModel

    print(f"loading {model_size} ({compute}, {threads} threads)...", file=sys.stderr, flush=True)
    model = WhisperModel(model_size, device="cpu", compute_type=compute, cpu_threads=threads)

    segments, info = model.transcribe(audio, language=lang, beam_size=5, vad_filter=True)
    segs = []
    for s in segments:  # generator — runs the actual work as we iterate
        txt = s.text.strip()
        if txt:
            segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": txt})
        if len(segs) % 25 == 0:
            print(f"  {len(segs)} segments...", file=sys.stderr, flush=True)

    out = {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 2),
        "model": f"faster-whisper:{model_size}",
        "segments": segs,
        "text": " ".join(s["text"] for s in segs),
    }
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
