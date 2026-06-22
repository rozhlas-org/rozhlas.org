// Cover-art thumbnails. Source images on the radio portal are full-resolution
// originals (often 1–5 MB) but we only ever render them as ~240–320px thumbnails.
// This fetches the original and writes a small square WebP into staging; the
// worker pins it to IPFS, so the site serves a ~30 KB file by CID instead of a
// multi-megabyte original.

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createLogger } from "@rozhlas/core";

const log = createLogger("media:artwork");

const USER_AGENT = "rozhlas-org-bot/0.1 (+https://github.com/rozhlas-org/rozhlas.org)";
// Reuse the audio staging dir; the worker deletes the temp file right after pin.
const STAGING_DIR = process.env.AUDIO_STAGING_DIR ?? join(tmpdir(), "rozhlas-audio");
const MAX_BYTES = 25 * 1024 * 1024; // refuse absurd source images (decompression-bomb guard)
const EDGE = 400; // square thumbnail edge — covers the grid (~240px) and detail (320px)
const QUALITY = 80;

export interface Thumbnail {
  path: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface ThumbnailOpts {
  /** Aborts the fetch — wire a job watchdog here. */
  signal?: AbortSignal;
  /** Abort the download if it hasn't completed in this long. Default 30s. */
  timeoutMs?: number;
}

/**
 * Fetch a remote cover image and write a `EDGE`×`EDGE` WebP into staging.
 * Returns the temp path (caller pins it, then deletes via `discardTemp`).
 */
export async function makeThumbnail(url: string, idHint: string, opts: ThumbnailOpts = {}): Promise<Thumbnail> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: ac.signal });
    if (!res.ok) throw new Error(`artwork download failed: ${res.status}`);
    const declared = Number(res.headers.get("content-length")) || 0;
    if (declared > MAX_BYTES) throw new Error(`artwork too large: ${declared} bytes`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error(`artwork too large: ${buf.byteLength} bytes`);

    return thumbnailFromBuffer(buf, idHint);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Resize an in-memory image (an admin upload, etc.) to the same `EDGE`×`EDGE` WebP
 * and write it into staging. Caller pins it, then deletes via `discardTemp`.
 */
export async function thumbnailFromBuffer(buf: Buffer, idHint: string): Promise<Thumbnail> {
  if (buf.byteLength > MAX_BYTES) throw new Error(`image too large: ${buf.byteLength} bytes`);
  await mkdir(STAGING_DIR, { recursive: true });
  const safe = idHint.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "thumb";
  const path = join(STAGING_DIR, `${safe}.webp`);
  // `failOn: "none"` tolerates slightly malformed source JPEGs; `.rotate()`
  // honors EXIF orientation; cover-crop to a centered square.
  const info = await sharp(buf, { failOn: "none" })
    .rotate()
    .resize(EDGE, EDGE, { fit: "cover", position: "centre" })
    .webp({ quality: QUALITY })
    .toFile(path);
  log.debug("thumbnail", { sourceBytes: buf.byteLength, outBytes: info.size });
  return { path, width: info.width, height: info.height, sizeBytes: info.size };
}
