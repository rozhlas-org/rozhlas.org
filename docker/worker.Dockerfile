# Worker service: BullMQ pipeline processors. Needs ffmpeg for audio acquisition.
# Debian base (not alpine) so the sqlite-vec glibc prebuilt loads for embeddings.
FROM oven/bun:1

# ffmpeg: assembles DASH/HLS .m4s segments in the acquire-audio stage (PLAN §7).
# python3 + faster-whisper (CTranslate2, CPU — no torch/CUDA) for the transcribe
# stage. The large-v3 model is NOT baked in; it downloads on first use into
# HF_HOME (a mounted volume), so the image stays lean and the model persists.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/whisper-venv \
    && /opt/whisper-venv/bin/pip install --no-cache-dir faster-whisper

WORKDIR /app

COPY package.json bunfig.toml ./
COPY packages/core/package.json ./packages/core/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/scrapers/package.json ./packages/scrapers/
COPY packages/ipfs/package.json ./packages/ipfs/
COPY packages/media/package.json ./packages/media/
COPY packages/embeddings/package.json ./packages/embeddings/
COPY packages/api/package.json ./packages/api/
COPY packages/worker/package.json ./packages/worker/
RUN bun install

COPY . .

ENV NODE_ENV=production

# Migrations are applied by the web service; the worker just processes jobs.
CMD ["bun", "run", "--cwd", "packages/worker", "start"]
