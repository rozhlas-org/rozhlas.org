import { createLogger, knnChunks, knnShows, knnShowsByTranscript, type ChunkKnnHit, type KnnHit } from "@rozhlas/core";
import { ftsMatch, type FtsIndex } from "./fts.ts";

/**
 * Off-main-thread search queries (sqlite-vec KNN + FTS5 matches). A small pool of worker
 * threads (vec-worker.ts), each with its own DB connection, so a slow vector scan or a
 * cold-cache FTS match only delays the search that asked for it — not every concurrent
 * API request. Requests go to the least-busy worker; a worker that errors or times out
 * is replaced, and the call falls back to running in-process so a search still answers.
 */

const log = createLogger("api:vec-pool");

export type VecTable = "shows" | "showTranscripts" | "chunks";
type VecHit = { id: number; distance: number };
export type PoolRequest =
  | { id: number; kind: "knn"; table: VecTable; vec: Float32Array; k: number }
  | { id: number; kind: "fts"; index: FtsIndex; match: string; limit: number };
// Distributes over the union so each job keeps its own fields.
type PoolJob = PoolRequest extends infer R ? (R extends PoolRequest ? Omit<R, "id"> : never) : never;
export type PoolResponse =
  | { id: number; rows: VecHit[] | number[]; error?: undefined }
  | { id: number; error: string; rows?: undefined };

const POOL_SIZE = 2;
const TIMEOUT_MS = 15_000;

interface Pending {
  resolve: (rows: VecHit[] | number[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface Slot {
  worker: Worker;
  pending: Map<number, Pending>;
}

let nextId = 1;
const slots: Slot[] = [];

function spawn(): Slot {
  const worker = new Worker(new URL("./vec-worker.ts", import.meta.url));
  const slot: Slot = { worker, pending: new Map() };
  worker.onmessage = (e: MessageEvent<PoolResponse>) => {
    const p = slot.pending.get(e.data.id);
    if (!p) return;
    slot.pending.delete(e.data.id);
    clearTimeout(p.timer);
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data.rows);
  };
  worker.onerror = (e) => replace(slot, new Error(`vec worker crashed: ${e.message}`));
  return slot;
}

/** Fail everything in flight on `slot` and swap in a fresh worker. */
function replace(slot: Slot, err: Error): void {
  const i = slots.indexOf(slot);
  if (i < 0) return;
  log.warn("replacing vec worker", { err: String(err) });
  for (const p of slot.pending.values()) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  slot.pending.clear();
  slot.worker.terminate();
  slots[i] = spawn();
}

function run(job: PoolJob): Promise<VecHit[] | number[]> {
  while (slots.length < POOL_SIZE) slots.push(spawn());
  const slot = slots.reduce((a, b) => (b.pending.size < a.pending.size ? b : a));
  const id = nextId++;
  const what = job.kind === "knn" ? `vec ${job.table}` : `fts ${job.index}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => replace(slot, new Error(`${what} timed out`)), TIMEOUT_MS);
    slot.pending.set(id, { resolve, reject, timer });
    slot.worker.postMessage({ ...job, id } as PoolRequest);
  });
}

/** Run off-thread; on worker failure, fall back to the in-process (blocking) query. */
async function knn<T>(
  table: VecTable,
  vec: Float32Array,
  k: number,
  map: (h: VecHit) => T,
  fallback: () => T[],
): Promise<T[]> {
  try {
    return ((await run({ kind: "knn", table, vec, k })) as VecHit[]).map(map);
  } catch (err) {
    log.warn("vec worker failed; querying in-process", { table, err: String(err) });
    return fallback();
  }
}

/** FTS5 row ids for a prepared MATCH expression, best first — off-thread, same fallback. */
export async function ftsMatchAsync(index: FtsIndex, match: string, limit: number): Promise<number[]> {
  try {
    return (await run({ kind: "fts", index, match, limit })) as number[];
  } catch (err) {
    log.warn("search worker failed; matching in-process", { index, err: String(err) });
    return ftsMatch(index, match, limit);
  }
}

export const knnShowsAsync = (vec: Float32Array, k: number): Promise<KnnHit[]> =>
  knn("shows", vec, k, (h) => ({ showId: h.id, distance: h.distance }), () => knnShows(vec, k));

export const knnShowsByTranscriptAsync = (vec: Float32Array, k: number): Promise<KnnHit[]> =>
  knn("showTranscripts", vec, k, (h) => ({ showId: h.id, distance: h.distance }), () => knnShowsByTranscript(vec, k));

export const knnChunksAsync = (vec: Float32Array, k: number): Promise<ChunkKnnHit[]> =>
  knn("chunks", vec, k, (h) => ({ chunkId: h.id, distance: h.distance }), () => knnChunks(vec, k));
