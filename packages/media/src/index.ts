import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@rozhlas/core";

export { makeThumbnail, thumbnailFromBuffer, type Thumbnail } from "./artwork.ts";
export {
  transcribeAudio,
  transcriptionEnabled,
  chunkSegments,
  type Transcription,
  type TranscriptSegment,
  type TranscriptChunk,
} from "./transcribe.ts";
export { groqTranscribe, groqEnabled, GroqFileTooLargeError } from "./groq.ts";

const log = createLogger("media");

const USER_AGENT = "rozhlas-org-bot/0.1 (+https://github.com/rozhlas-org/rozhlas.org)";
const STAGING_DIR = process.env.AUDIO_STAGING_DIR ?? join(tmpdir(), "rozhlas-audio");

export interface AcquireInput {
  /** `file` = direct download (mp3); `dash`/`hls` = streaming manifest (m4s). */
  kind: "file" | "dash" | "hls";
  url: string;
  headers?: Record<string, string>;
}

export interface AcquiredAudio {
  path: string;
  container: string; // mp3 / m4a
  codec?: string;
  bitrate?: number;
  durationSec?: number;
  sizeBytes: number;
  checksum: string;
}

export interface AcquireProgress {
  stage: "download" | "assemble" | "probe";
  percent: number; // 0-100 (download has real %; assemble is coarse)
}

export interface AcquireOpts {
  /** Aborts the whole acquire (download or ffmpeg) — wire a job watchdog here. */
  signal?: AbortSignal;
  /** Heartbeat callback (throttled to ~5% steps). */
  onProgress?: (p: AcquireProgress) => void;
  /** Abort a download if no bytes arrive for this long. Default 30s. */
  stallMs?: number;
  /** Hard cap for ffmpeg assembly. Default 300s. */
  ffmpegTimeoutMs?: number;
}

const DEFAULT_STALL_MS = 30_000;
const DEFAULT_FFMPEG_MS = 300_000;

/** Run a child process; killable via signal or timeout (returns ok=false on kill). */
async function run(
  cmd: string[],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const kill = () => {
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
  };
  const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : undefined;
  if (opts.signal) {
    if (opts.signal.aborted) kill();
    else opts.signal.addEventListener("abort", kill, { once: true });
  }
  try {
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { ok: code === 0, stderr };
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", kill);
  }
}

/**
 * Stream a URL to a file with a stall watchdog: if no bytes arrive within
 * `stallMs`, or the external signal fires, the download is aborted and throws
 * (so the job fails → retries instead of hanging a worker slot forever).
 */
async function downloadToFile(
  url: string,
  dest: string,
  headers: Record<string, string>,
  opts: AcquireOpts,
): Promise<void> {
  const stallMs = opts.stallMs ?? DEFAULT_STALL_MS;
  const ac = new AbortController();
  const abort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener("abort", abort, { once: true });
  }
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(abort, stallMs);
  };
  try {
    armStall();
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    if (!res.body) throw new Error("download failed: empty body");
    const total = Number(res.headers.get("content-length")) || 0;
    const writer = Bun.file(dest).writer();
    let received = 0;
    let bucket = -1;
    try {
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        writer.write(chunk);
        received += chunk.byteLength;
        armStall(); // got bytes — reset the stall clock
        if (opts.onProgress && total) {
          const percent = Math.min(99, Math.round((received / total) * 100));
          const b = Math.floor(percent / 5);
          if (b !== bucket) {
            bucket = b;
            opts.onProgress({ stage: "download", percent });
          }
        }
      }
    } finally {
      await writer.end();
    }
    if (total && received < total) {
      throw new Error(`incomplete download: ${received}/${total} bytes`);
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    opts.signal?.removeEventListener("abort", abort);
  }
}

/** ffprobe → format/codec/duration/bitrate. */
async function probe(path: string): Promise<Partial<AcquiredAudio>> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  try {
    const j = JSON.parse(out);
    const audio = (j.streams ?? []).find((s: any) => s.codec_type === "audio");
    const durationSec = j.format?.duration ? Math.round(Number(j.format.duration)) : undefined;
    const bitrate = j.format?.bit_rate ? Number(j.format.bit_rate) : undefined;
    return { codec: audio?.codec_name, durationSec, bitrate };
  } catch {
    return {};
  }
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

/**
 * Acquire a show's audio into a temp file (the caller deletes it after ipfs-add).
 * - `file`  → direct download, kept in its native container (mp3).
 * - `dash`/`hls` → ffmpeg assembles the segments and remuxes to .m4a (stream-copy,
 *   lossless, no re-encode) per PLAN §2.
 */
export async function acquireAudio(
  input: AcquireInput,
  idHint: string,
  opts: AcquireOpts = {},
): Promise<AcquiredAudio> {
  await mkdir(STAGING_DIR, { recursive: true });
  const safeId = idHint.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "audio";

  let path: string;
  let container: string;

  if (input.kind === "file") {
    container = "mp3";
    path = join(STAGING_DIR, `${safeId}.mp3`);
    log.info("downloading", { url: input.url });
    opts.onProgress?.({ stage: "download", percent: 0 });
    await downloadToFile(
      input.url,
      path,
      { "user-agent": USER_AGENT, ...input.headers },
      opts,
    );
  } else {
    container = "m4a";
    path = join(STAGING_DIR, `${safeId}.m4a`);
    log.info("assembling stream with ffmpeg", { kind: input.kind, url: input.url });
    opts.onProgress?.({ stage: "assemble", percent: 0 });
    const headerArgs = input.headers
      ? ["-headers", Object.entries(input.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")]
      : [];
    // Stream-copy AAC into an mp4/m4a container; HLS needs the ADTS->ASC bitstream filter.
    const cmd = [
      "ffmpeg", "-y", "-loglevel", "error",
      "-user_agent", USER_AGENT,
      ...headerArgs,
      "-i", input.url,
      "-c", "copy",
      ...(input.kind === "hls" ? ["-bsf:a", "aac_adtstoasc"] : []),
      "-movflags", "+faststart",
      path,
    ];
    const { ok, stderr } = await run(cmd, {
      signal: opts.signal,
      timeoutMs: opts.ffmpegTimeoutMs ?? DEFAULT_FFMPEG_MS,
    });
    if (!ok) throw new Error(`ffmpeg failed/timed out: ${stderr.slice(0, 500)}`);
  }

  opts.onProgress?.({ stage: "probe", percent: 100 });
  const { size } = await stat(path);
  const meta = await probe(path);
  const checksum = await sha256(path);
  return {
    path,
    container,
    sizeBytes: size,
    checksum,
    codec: meta.codec,
    bitrate: meta.bitrate,
    durationSec: meta.durationSec,
  };
}

/** Best-effort cleanup of a staged temp file. */
export async function discardTemp(path: string): Promise<void> {
  await rm(path, { force: true });
}
