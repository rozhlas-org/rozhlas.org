import { Queue, type JobsOptions } from "bullmq";
import { connection } from "./connection.ts";

/**
 * The scrape → store → IPFS pipeline, one queue per stage (see docs/PLAN.md §7).
 * Stages hand off to the next queue from within their worker.
 */
export const QUEUE_NAMES = [
  "discover",
  "fetch-metadata",
  "acquire-audio",
  "acquire-artwork",
  "extract-tags",
  "ipfs-add",
  "ipfs-verify",
  "index",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** Typed payloads per queue. */
export interface JobData {
  discover: {
    sourceKey: string;
    limit?: number;
    options?: Record<string, unknown>;
  };
  // Reserved for detail-page sources (mujRozhlas, Phase 3).
  "fetch-metadata": { sourceKey: string; sourceId: string; url?: string };
  "acquire-audio": { audioFileId: number };
  // Fetch a show's cover, resize to a small WebP, pin to IPFS, store the CID.
  "acquire-artwork": { artworkId: number };
  // Reserved: embed tags/artwork before ipfs-add (Phase 2+).
  "extract-tags": { audioFileId: number; tempPath: string };
  "ipfs-add": { audioFileId: number; tempPath: string };
  "ipfs-verify": { audioFileId: number };
  index: { showId: number };
}

/** Sensible defaults: retry with backoff, keep history bounded for the dashboard. */
export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

const registry = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = registry.get(name);
  if (!q) {
    q = new Queue(name, { connection, defaultJobOptions });
    registry.set(name, q);
  }
  return q;
}

/** All queues, instantiated — used by the worker and the Bull Board dashboard. */
export function allQueues(): Queue[] {
  return QUEUE_NAMES.map((n) => getQueue(n));
}

/**
 * Enqueue a job onto a stage queue. Payload type is enforced here via `JobData`;
 * the queue itself is left untyped so BullMQ's job-name generics don't leak out.
 */
export function enqueue<N extends QueueName>(
  name: N,
  data: JobData[N],
  opts?: JobsOptions,
) {
  return getQueue(name).add(name, data, opts);
}
