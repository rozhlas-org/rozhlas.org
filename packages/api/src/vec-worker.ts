// Worker thread for the heavy, synchronous parts of search. bun:sqlite blocks its
// thread: a brute-force scan of vec_chunks (~240k × 1024 floats) takes ~0.7 s, and a
// ranked FTS match on a cold page cache can take seconds — run on the API's main thread
// either froze every other request (healthz included). Importing core here opens this
// thread's own connection (WAL: readers don't block each other).
import { knnChunks, knnShows, knnShowsByTranscript } from "@rozhlas/core";
import { ftsMatch } from "./fts.ts";
import type { PoolRequest, PoolResponse } from "./vec-pool.ts";

declare const self: Worker;

const KNN = {
  shows: (v: Float32Array, k: number) => knnShows(v, k).map((h) => ({ id: h.showId, distance: h.distance })),
  showTranscripts: (v: Float32Array, k: number) =>
    knnShowsByTranscript(v, k).map((h) => ({ id: h.showId, distance: h.distance })),
  chunks: (v: Float32Array, k: number) => knnChunks(v, k).map((h) => ({ id: h.chunkId, distance: h.distance })),
};

self.onmessage = (e: MessageEvent<PoolRequest>) => {
  const req = e.data;
  let res: PoolResponse;
  try {
    const rows = req.kind === "knn" ? KNN[req.table](req.vec, req.k) : ftsMatch(req.index, req.match, req.limit);
    res = { id: req.id, rows };
  } catch (err) {
    res = { id: req.id, error: String(err) };
  }
  self.postMessage(res);
};
