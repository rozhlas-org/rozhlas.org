// (Re)compute the pooled per-show transcript vector (mean of a show's chunk vectors) for
// transcript-based "similar shows". Local only — no Voyage calls. New transcripts pool
// themselves via the embed-transcript job; this is the one-time backfill for the already-
// embedded archive.
// Usage: bun run scripts/transcript-pool-backfill.ts [--force]
import { getProvider, poolShowTranscripts } from "@rozhlas/embeddings";

const provider = getProvider();
console.log("provider:", provider.id, "dims:", provider.dims);
const result = await poolShowTranscripts(provider, { force: process.argv.includes("--force") });
console.log("done:", result);
process.exit(0);
