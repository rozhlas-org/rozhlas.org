// Embed all (or not-yet-embedded) shows into the vector store.
// Usage: bun run scripts/embed-backfill.ts [--force]
import { getProvider, embedShows } from "@rozhlas/embeddings";

const provider = getProvider();
console.log("provider:", provider.id, "dims:", provider.dims);
const result = await embedShows(provider, { force: process.argv.includes("--force") });
console.log("done:", result);
process.exit(0);
