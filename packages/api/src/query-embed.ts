import { createLogger } from "@rozhlas/core";
import { getProvider } from "@rozhlas/embeddings";

const log = createLogger("api:query-embed");

// A search waits on this call; the provider's own 60 s timeout suits batch indexing,
// not a person staring at a spinner. Past this, search degrades to its keyword legs.
const QUERY_EMBED_TIMEOUT_MS = 5_000;
const CACHE_MAX = 500;
const cache = new Map<string, Float32Array>();

/**
 * Embed a search query (input_type "query"), cached and time-boxed. Returns undefined
 * when the provider is down, rate-limited or slow — callers fall back to keyword search.
 */
export async function embedQuery(text: string): Promise<Float32Array | undefined> {
  const key = text.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // LRU: re-insert as most recent
    cache.set(key, hit);
    return hit;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [vec] = await Promise.race([
      getProvider().embed([text], "query"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${QUERY_EMBED_TIMEOUT_MS} ms`)), QUERY_EMBED_TIMEOUT_MS);
      }),
    ]);
    if (!vec) return undefined;
    cache.set(key, vec);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return vec;
  } catch (err) {
    log.warn("query embedding unavailable; using keyword search only", { err: String(err) });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
