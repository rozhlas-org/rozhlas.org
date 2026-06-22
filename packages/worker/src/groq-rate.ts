// Self-pacing rate window + heartbeat for the Groq backfill. A tiny Redis sorted
// set of (timestamp → audio-seconds) entries in the trailing hour; the tick keeps
// the sum under the free-tier ceiling. Concurrency-1 consumer → no reservation race.

import { connection } from "@rozhlas/jobs";

const WINDOW = "groq:ratewindow"; // ZSET: score = ms timestamp, member = "ts:seconds:rand"
const HEARTBEAT = "groq:heartbeat"; // last tick ms (dead-man's-switch)

/** Audio-seconds submitted to Groq in the last 60 minutes (trims expired entries). */
export async function groqUsedSecondsLastHour(): Promise<number> {
  const now = Date.now();
  await connection.zremrangebyscore(WINDOW, 0, now - 3_600_000);
  const members = (await connection.zrange(WINDOW, 0, -1)) as string[];
  return members.reduce((sum, m) => sum + (Number(m.split(":")[1]) || 0), 0);
}

/** Record a completed Groq transcription's audio-seconds against the window. */
export async function groqRecordUsage(seconds: number): Promise<void> {
  const now = Date.now();
  const member = `${now}:${Math.max(0, Math.round(seconds))}:${now.toString(36)}`;
  await connection.zadd(WINDOW, now, member);
}

const COOLDOWN = "groq:cooldown"; // pause-until after a 429 (auto-expiring key)

/** After a 429, pause the whole backfill for `ms` (instead of retrying every tick). */
export async function groqSetCooldown(ms: number): Promise<void> {
  await connection.set(COOLDOWN, String(Date.now() + ms), "PX", ms);
}

/** True while a post-429 cooldown is active. */
export async function groqInCooldown(): Promise<boolean> {
  return (await connection.exists(COOLDOWN)) === 1;
}

/** Heartbeat each tick so a stall is detectable (read by the dead-man's-switch). */
export async function groqHeartbeat(): Promise<void> {
  await connection.set(HEARTBEAT, String(Date.now()));
}

/** ms since the last tick, or null if never. */
export async function groqSecondsSinceHeartbeat(): Promise<number | null> {
  const v = await connection.get(HEARTBEAT);
  return v ? Math.round((Date.now() - Number(v)) / 1000) : null;
}
