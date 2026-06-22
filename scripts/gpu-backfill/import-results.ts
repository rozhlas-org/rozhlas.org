// Import GPU-backfill results (out/<id>.json) → transcripts + chunks + embed.
// Idempotent + validity-checked. Reuses the live pipeline (saveTranscript →
// FTS auto → embed-transcript). Safe to re-run and safe alongside Groq steady-state.
//
// Run INSIDE the worker container (needs DB + Redis):
//   docker compose exec worker bun run /app/scripts/gpu-backfill/import-results.ts --dir /data/gpu-out

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "@rozhlas/core";
import { chunkSegments } from "@rozhlas/media";
import { enqueue } from "@rozhlas/jobs";
import { getAudio, transcriptExists, saveTranscript } from "../../packages/worker/src/repo.ts";

const argv = process.argv.slice(2);
const dir = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1]! : "/data/gpu-out";

interface Result {
  audioFileId: number;
  language: string | null;
  duration: number;
  model: string;
  segments: { start: number; end: number; text: string }[];
  text: string;
}

const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
let imported = 0,
  skipped = 0,
  invalid = 0;

for (const f of files) {
  let r: Result;
  try {
    r = JSON.parse(await readFile(join(dir, f), "utf8"));
  } catch {
    invalid++;
    continue;
  }
  if (!r?.audioFileId || !Array.isArray(r.segments) || r.segments.length === 0) {
    invalid++;
    continue; // corrupt/empty — leave it for a re-run, don't store junk
  }
  if (await transcriptExists(r.audioFileId)) {
    skipped++;
    continue; // Groq steady-state or a prior import already did it
  }
  const audio = await getAudio(r.audioFileId);
  if (!audio) {
    skipped++;
    continue;
  }
  const chunks = chunkSegments(r.segments, config.TRANSCRIPT_CHUNK_CHARS);
  const transcriptId = saveTranscript(r.audioFileId, audio.showId, {
    lang: r.language,
    model: r.model,
    text: r.text,
    segmentsJson: JSON.stringify(r.segments),
    durationSec: Math.round(r.duration),
    chunks,
  });
  await enqueue("embed-transcript", { transcriptId }, { jobId: `emb-${transcriptId}`, removeOnComplete: true });
  imported++;
  if (imported % 50 === 0) console.log(`  imported ${imported}…`);
}

console.log(`done: imported ${imported}, skipped ${skipped} (exists/no-audio), invalid ${invalid} of ${files.length}`);
process.exit(0);
