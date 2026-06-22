// Groq free-tier transcription provider. Downloads audio (by gateway URL),
// transcodes to 16 kHz mono Opus so it stays under Groq's 25 MB free upload cap
// (our originals avg ~42 MB; Groq silently fails >30 MB), uploads to the Groq
// Whisper endpoint, and returns the same `Transcription` shape as the local path.
// Temp files are always deleted — audio is never kept on disk.

import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, createLogger } from "@rozhlas/core";
import type { Transcription, TranscriptSegment } from "./transcribe.ts";

const log = createLogger("media:groq");
const USER_AGENT = "rozhlas-org-bot/0.1 (+https://github.com/rozhlas-org/rozhlas.org)";
const STAGING_DIR = process.env.AUDIO_STAGING_DIR ?? join(tmpdir(), "rozhlas-audio");

/** True when the Groq backfill is configured + enabled. */
export function groqEnabled(): boolean {
  return !!config.GROQ_API_KEY && config.GROQ_BACKFILL_ENABLED;
}

/** Thrown when the transcoded file is still over the upload cap (multi-hour outlier → defer). */
export class GroqFileTooLargeError extends Error {}

async function run(cmd: string[], signal?: AbortSignal): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  if (signal) {
    if (signal.aborted) proc.kill();
    else signal.addEventListener("abort", () => proc.kill(), { once: true });
  }
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`ffmpeg failed: ${stderr.slice(-300)}`);
}

/** Map Groq verbose_json → our Transcription. */
function fromVerboseJson(j: {
  text?: string;
  language?: string;
  duration?: number;
  segments?: { start: number; end: number; text: string }[];
}): Transcription {
  const segments: TranscriptSegment[] = (j.segments ?? []).map((s) => ({
    start: Math.round(s.start * 100) / 100,
    end: Math.round(s.end * 100) / 100,
    text: s.text.trim(),
  }));
  return {
    lang: j.language ?? null,
    langProbability: null,
    durationSec: Math.round(j.duration ?? 0),
    model: `groq:${config.GROQ_STT_MODEL}`,
    text: j.text?.trim() ?? segments.map((s) => s.text).join(" "),
    segments,
  };
}

export interface GroqTranscribeOpts {
  signal?: AbortSignal;
  timeoutMs?: number; // whole fetch+transcode+upload. Default 10 min.
}

/**
 * Transcribe audio at `url` via Groq. Throws `GroqFileTooLargeError` if the file
 * is still over the upload cap after 16 kHz-mono transcode (caller defers it).
 */
export async function groqTranscribe(
  url: string,
  idHint: string,
  opts: GroqTranscribeOpts = {},
): Promise<Transcription> {
  if (!config.GROQ_API_KEY) throw new Error("GROQ_API_KEY unset");
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10 * 60_000);

  await mkdir(STAGING_DIR, { recursive: true });
  const safe = idHint.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "audio";
  const src = join(STAGING_DIR, `gq-${safe}.src`);
  const enc = join(STAGING_DIR, `gq-${safe}.ogg`);
  try {
    // 1. download original by CID
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`audio download failed: ${res.status}`);
    const w = Bun.file(src).writer();
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) w.write(chunk);
    await w.end();

    // 2. transcode → 16 kHz mono Opus (whisper resamples to 16 kHz anyway; ~6 MB for 33 min)
    await run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "16000",
      "-c:a", "libopus", "-b:a", "20k", enc], ac.signal);
    const bytes = (await stat(enc)).size;
    if (bytes > config.GROQ_MAX_UPLOAD_MB * 1024 * 1024) {
      throw new GroqFileTooLargeError(`${(bytes / 1e6).toFixed(1)} MB after transcode > cap`);
    }

    // 3. upload to Groq
    const form = new FormData();
    form.append("file", Bun.file(enc), `${safe}.ogg`);
    form.append("model", config.GROQ_STT_MODEL);
    form.append("language", "cs");
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    const r = await fetch(`${config.GROQ_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.GROQ_API_KEY}` },
      body: form,
      signal: ac.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      const err = new Error(`groq ${r.status}: ${body.slice(0, 200)}`);
      (err as { status?: number }).status = r.status; // 429 → caller backs off
      throw err;
    }
    const json = (await r.json()) as Parameters<typeof fromVerboseJson>[0];
    const t = fromVerboseJson(json);
    if (!t.segments.length) throw new Error("groq returned no segments");
    log.debug("groq transcribed", { url, segments: t.segments.length, uploadKB: Math.round(bytes / 1024) });
    return t;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    await rm(src, { force: true });
    await rm(enc, { force: true });
  }
}
