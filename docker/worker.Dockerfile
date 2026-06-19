# Worker service: BullMQ pipeline workers. Needs ffmpeg for audio acquisition.
FROM oven/bun:1-alpine

# ffmpeg: assembles DASH/HLS .m4s segments in the acquire-audio stage (PLAN §7)
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json bunfig.toml ./
COPY packages/core/package.json ./packages/core/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/scrapers/package.json ./packages/scrapers/
COPY packages/ipfs/package.json ./packages/ipfs/
COPY packages/media/package.json ./packages/media/
COPY packages/api/package.json ./packages/api/
COPY packages/worker/package.json ./packages/worker/
RUN bun install

COPY . .

ENV NODE_ENV=production

# Migrations are applied by the web service; the worker just processes jobs.
CMD ["bun", "run", "--cwd", "packages/worker", "start"]
