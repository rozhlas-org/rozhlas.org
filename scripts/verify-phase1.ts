// Phase 1 end-to-end: enqueue a discover for one episode and wait until its
// audio is acquired, pinned to IPFS, and verified streamable.
import { db, schema } from "@rozhlas/core";
import { enqueue, connection } from "@rozhlas/jobs";
import { ipfs } from "@rozhlas/ipfs";
import { eq, isNotNull } from "drizzle-orm";

const { audioFiles, shows } = schema;

await enqueue("discover", {
  sourceKey: "iradio",
  limit: 1,
  options: { feeds: ["8109468"] },
});
console.log("enqueued discover (iradio, 1 episode)");

let audio: typeof audioFiles.$inferSelect | undefined;
for (let i = 0; i < 120; i++) {
  const rows = await db
    .select()
    .from(audioFiles)
    .where(isNotNull(audioFiles.ipfsCid))
    .limit(1);
  if (rows[0]?.streamable) {
    audio = rows[0];
    break;
  }
  await Bun.sleep(1000);
}

if (!audio?.ipfsCid) {
  console.error("TIMEOUT: no streamable audio produced");
  await connection.quit();
  process.exit(1);
}

const [show] = await db.select().from(shows).where(eq(shows.id, audio.showId));
console.log("SHOW :", show?.title);
console.log("META :", {
  durationSec: audio.durationSec,
  codec: audio.codec,
  container: audio.container,
  sizeBytes: audio.sizeBytes,
});
console.log("CID  :", audio.ipfsCid, "streamable:", audio.streamable);

const url = ipfs.gatewayFor(audio.ipfsCid);
const r = await fetch(url, { headers: { Range: "bytes=0-255" } });
console.log("GATE :", url);
console.log("GATE range status:", r.status, "type:", r.headers.get("content-type"));
await r.body?.cancel();

await connection.quit();
process.exit(r.status === 206 || r.status === 200 ? 0 : 1);
