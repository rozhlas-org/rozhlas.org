import { z } from "zod";

/**
 * Centralised, validated configuration. Reads from the process environment
 * (Bun auto-loads `.env`). Fails fast with a readable error if something is off.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_PATH: z.string().default("./data/rozhlas.db"),

  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  IPFS_API_URL: z.string().url().default("http://localhost:5001"),
  IPFS_GATEWAY_URL: z.string().url().default("http://localhost:8080"),

  BULL_BOARD_PATH: z.string().startsWith("/").default("/admin/jobs"),
});

export type Config = z.infer<typeof EnvSchema>;

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config: Config = load();

export const isProd = config.NODE_ENV === "production";
