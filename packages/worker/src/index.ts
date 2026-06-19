import { Worker, type Processor } from "bullmq";
import { createLogger } from "@rozhlas/core";
import { connection, QUEUE_NAMES, type QueueName } from "@rozhlas/jobs";

const log = createLogger("worker");

/**
 * Stage processors. Phase 0 ships stubs that log and succeed so the pipeline is
 * bootable end-to-end; real logic lands per stage in Phase 1+.
 */
const processors: Partial<Record<QueueName, Processor>> = {
  // e.g. discover: discoverProcessor (Phase 1)
};

function stub(name: QueueName): Processor {
  return async (job) => {
    log.warn(`stub: ${name} not implemented`, { jobId: job.id, data: job.data });
    return { stub: true, stage: name };
  };
}

const concurrency: Partial<Record<QueueName, number>> = {
  "acquire-audio": 2, // ffmpeg is heavy
  "ipfs-add": 2,
};

const workers = QUEUE_NAMES.map((name) => {
  const w = new Worker(name, processors[name] ?? stub(name), {
    connection,
    concurrency: concurrency[name] ?? 5,
  });
  w.on("completed", (job) => log.debug(`${name} completed`, { jobId: job.id }));
  w.on("failed", (job, err) =>
    log.error(`${name} failed`, { jobId: job?.id, err: err.message }),
  );
  return w;
});

log.info("worker started", { queues: QUEUE_NAMES.length });

async function shutdown(signal: string) {
  log.info("shutting down", { signal });
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
