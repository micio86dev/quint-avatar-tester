# quint-avatar-tester — Astro 7 SSR (Node standalone) + native better-sqlite3.
# Single-stage image: devDependencies (incl. tsx) stay available so the seed script
# runs at container start. Uses the full node:24 image so node-gyp can compile
# better-sqlite3 if a prebuilt binary is unavailable for the platform.
FROM node:24-bookworm

WORKDIR /app

# Install deps first for layer caching. package.json carries the `allowScripts`
# allowlist, so better-sqlite3's native build script runs under npm 11.
COPY package.json package-lock.json ./
RUN npm ci

# App source, then fetch proctor assets (MediaPipe wasm + face model) and build.
COPY . .
RUN npm run proctor:assets && npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# DATABASE_PATH must point at a mounted Railway volume so the SQLite file persists
# across restarts/deploys, e.g. DATABASE_PATH=/data/interviews.db (volume at /data).
# Webcam snapshots default to <DATABASE_PATH dir>/snapshots (e.g. /data/snapshots), so the
# same volume keeps them too — otherwise every redeploy wipes the images. SNAPSHOTS_PATH
# overrides the location explicitly if needed.

EXPOSE 4321

# Seed is idempotent (no-op once prompts exist); migrations auto-apply on first DB open.
CMD ["sh", "-c", "npm run db:seed && node ./dist/server/entry.mjs"]
