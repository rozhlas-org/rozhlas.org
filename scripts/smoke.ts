// Phase 0 smoke test: enqueue a job and confirm the worker processes it.
import { enqueue, getQueue, connection } from "@rozhlas/jobs";

const job = await enqueue("discover", { sourceKey: "smoke-test" });
console.log("enqueued job", job.id);

const q = getQueue("discover");
let counts = await q.getJobCounts();
for (let i = 0; i < 20 && (counts.completed ?? 0) < 1; i++) {
  await Bun.sleep(250);
  counts = await q.getJobCounts();
}

console.log("discover queue counts:", JSON.stringify(counts));
await connection.quit();
process.exit((counts.completed ?? 0) >= 1 ? 0 : 1);
