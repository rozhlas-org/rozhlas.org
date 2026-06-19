import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@rozhlas/core";

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

async function run(cmd: string[]): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { ok: code === 0, stderr };
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
): Promise<AcquiredAudio> {
  await mkdir(STAGING_DIR, { recursive: true });
  const safeId = idHint.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "audio";

  let path: string;
  let container: string;

  if (input.kind === "file") {
    container = "mp3";
    path = join(STAGING_DIR, `${safeId}.mp3`);
    log.info("downloading", { url: input.url });
    const res = await fetch(input.url, {
      headers: { "user-agent": USER_AGENT, ...input.headers },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    await Bun.write(path, res);
  } else {
    container = "m4a";
    path = join(STAGING_DIR, `${safeId}.m4a`);
    log.info("assembling stream with ffmpeg", { kind: input.kind, url: input.url });
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
    const { ok, stderr } = await run(cmd);
    if (!ok) throw new Error(`ffmpeg failed: ${stderr.slice(0, 500)}`);
  }

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
