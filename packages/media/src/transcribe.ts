// Transcription: download an audio file (by gateway URL), run faster-whisper as
// a Python subprocess (like ffmpeg), and return segment-timestamped text. The
// temp audio is deleted by the caller — audio is never kept on disk.

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, createLogger } from "@rozhlas/core";

const log = createLogger("media:transcribe");

const USER_AGENT = "rozhlas-org-bot/0.1 (+https://github.com/rozhlas-org/rozhlas.org)";
const STAGING_DIR = process.env.AUDIO_STAGING_DIR ?? join(tmpdir(), "rozhlas-audio");
// packages/media/src/transcribe.ts → packages/media/python/transcribe.py
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "python", "transcribe.py");

export interface TranscriptSegment {
  start: number; // seconds
  end: number;
  text: string;
}

export interface Transcription {
  lang: string | null;
  langProbability: number | null;
  durationSec: number;
  model: string;
  text: string;
  segments: TranscriptSegment[];
}

export interface TranscribeOpts {
  signal?: AbortSignal;
  /** Hard cap for the whole download+transcribe. Default 2h (a long episode at <1× realtime). */
  timeoutMs?: number;
}

/** True when transcription is configured (a Python with faster-whisper is set). */
export function transcriptionEnabled(): boolean {
  return !!config.WHISPER_PYTHON;
}

async function download(url: string, dest: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal });
  if (!res.ok || !res.body) throw new Error(`audio download failed: ${res.status}`);
  const writer = Bun.file(dest).writer();
  try {
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) writer.write(chunk);
  } finally {
    await writer.end();
  }
}

/**
 * Transcribe audio at `url` (e.g. the internal IPFS gateway). Downloads to a temp
 * file, runs whisper, returns segments. Throws if WHISPER_PYTHON is unset.
 */
export async function transcribeAudio(
  url: string,
  idHint: string,
  opts: TranscribeOpts = {},
): Promise<Transcription> {
  if (!config.WHISPER_PYTHON) throw new Error("transcription disabled: WHISPER_PYTHON unset");

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 2 * 60 * 60_000);

  await mkdir(STAGING_DIR, { recursive: true });
  const safe = idHint.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "audio";
  const audioPath = join(STAGING_DIR, `tx-${safe}`);
  try {
    log.info("downloading for transcription", { url });
    await download(url, audioPath, ac.signal);

    const proc = Bun.spawn(
      [config.WHISPER_PYTHON, SCRIPT, audioPath, config.WHISPER_MODEL, "cs"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, WHISPER_THREADS: String(config.WHISPER_THREADS) },
      },
    );
    const kill = () => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    };
    if (ac.signal.aborted) kill();
    else ac.signal.addEventListener("abort", kill, { once: true });

    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`whisper exited ${code}: ${err.slice(-500)}`);

    let parsed: {
      language: string | null;
      language_probability?: number;
      duration: number;
      model: string;
      segments: TranscriptSegment[];
      text: string;
    };
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new Error(`whisper produced unparseable output: ${out.slice(0, 200)}`);
    }
    return {
      lang: parsed.language,
      langProbability: parsed.language_probability ?? null,
      durationSec: Math.round(parsed.duration),
      model: parsed.model,
      text: parsed.text,
      segments: parsed.segments,
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    await rm(audioPath, { force: true });
  }
}

export interface TranscriptChunk {
  idx: number;
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Group whisper segments into ~`maxChars`-sized chunks (segment boundaries
 * preserved), each carrying its time span so a search hit can deep-link to the
 * moment in the player.
 */
export function chunkSegments(segments: TranscriptSegment[], maxChars = 1500): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let buf: TranscriptSegment[] = [];
  let len = 0;
  const flush = () => {
    if (!buf.length) return;
    chunks.push({
      idx: chunks.length,
      startSec: Math.floor(buf[0]!.start),
      endSec: Math.ceil(buf[buf.length - 1]!.end),
      text: buf.map((s) => s.text).join(" ").trim(),
    });
    buf = [];
    len = 0;
  };
  for (const s of segments) {
    buf.push(s);
    len += s.text.length + 1;
    if (len >= maxChars) flush();
  }
  flush();
  return chunks;
}
