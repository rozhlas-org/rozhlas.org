# Web/API service: Hono API + Bull Board dashboard
FROM oven/bun:1-alpine

WORKDIR /app

# Install workspace deps (copy manifests first for better layer caching)
COPY package.json bunfig.toml ./
COPY packages/core/package.json ./packages/core/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/api/package.json ./packages/api/
COPY packages/worker/package.json ./packages/worker/
RUN bun install

# App source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Run DB migrations (idempotent) on the web service, then start the API.
CMD ["sh", "-c", "bun run --cwd packages/core db:migrate && bun run --cwd packages/api start"]
