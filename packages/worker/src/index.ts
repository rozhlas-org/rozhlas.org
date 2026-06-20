import { Worker, type Job, type Processor } from "bullmq";
import { createLogger } from "@rozhlas/core";
import { connection, QUEUE_NAMES, type QueueName } from "@rozhlas/jobs";
import { buildProcessors } from "./processors.ts";
import { setupSchedules } from "./scheduler.ts";

const log = createLogger("worker");

const processors = await buildProcessors();

const concurrency: Partial<Record<QueueName, number>> = {
  // ffmpeg stream-copy is light CPU + I/O-bound; the box has 8 cores, so run more
  // in parallel to drain the acquire backlog (a hung job self-heals via the watchdog).
  "acquire-audio": 6,
  "acquire-artwork": 4,
  "ipfs-add": 4,
};

function fallback(name: QueueName): Processor {
  return async (job: Job) => {
    log.warn(`no processor registered for ${name}`, { jobId: job.id });
    return { unhandled: name };
  };
}

const workers = QUEUE_NAMES.map((name) => {
  const w = new Worker(name, processors[name] ?? fallback(name), {
    connection,
    concurrency: concurrency[name] ?? 5,
  });
  w.on("completed", (job) => log.debug(`${name} completed`, { jobId: job.id }));
  w.on("failed", (job, err) =>
    log.error(`${name} failed`, { jobId: job?.id, err: err.message }),
  );
  return w;
});

await setupSchedules();
log.info("worker started", { queues: QUEUE_NAMES.length });

async function shutdown(signal: string) {
  log.info("shutting down", { signal });
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
