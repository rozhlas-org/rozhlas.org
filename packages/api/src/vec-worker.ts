// Worker thread for sqlite-vec KNN. bun:sqlite is synchronous, and a brute-force scan of
// vec_chunks (~240k × 1024 floats) takes ~0.7 s — run on the API's main thread it froze
// every other request (healthz included) for the duration of each search. Importing
// core here opens this thread's own connection (WAL: readers don't block each other).
import { knnChunks, knnShows, knnShowsByTranscript } from "@rozhlas/core";
import type { VecRequest, VecResponse } from "./vec-pool.ts";

declare const self: Worker;

const KNN = {
  shows: (v: Float32Array, k: number) => knnShows(v, k).map((h) => ({ id: h.showId, distance: h.distance })),
  showTranscripts: (v: Float32Array, k: number) =>
    knnShowsByTranscript(v, k).map((h) => ({ id: h.showId, distance: h.distance })),
  chunks: (v: Float32Array, k: number) => knnChunks(v, k).map((h) => ({ id: h.chunkId, distance: h.distance })),
};

self.onmessage = (e: MessageEvent<VecRequest>) => {
  const { id, table, vec, k } = e.data;
  let res: VecResponse;
  try {
    res = { id, hits: KNN[table](vec, k) };
  } catch (err) {
    res = { id, error: String(err) };
  }
  self.postMessage(res);
};
