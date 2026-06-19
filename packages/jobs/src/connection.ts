import { Redis } from "ioredis";
import { config } from "@rozhlas/core";

/**
 * Shared ioredis connection for BullMQ. `maxRetriesPerRequest: null` is required
 * by BullMQ for blocking commands. Lazy-connects on first use.
 */
export const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
});
