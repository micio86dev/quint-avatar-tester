#!/usr/bin/env bash
#
# run.sh — build and run quint-avatar-tester locally in Docker.
#
# This is an Astro SSR app: a single Node process serves BOTH the pages
# (frontend) and the API routes (backend) on one port. So this launches ONE
# container, not two. The SQLite database lives in a Docker named volume so it
# survives container restarts. A named volume is used (instead of a host bind
# mount) because Docker Desktop on macOS cannot bind-mount a host path that
# contains a space — and this repo lives under "/Volumes/Scheda SSD".
#
# Usage:
#   ./run.sh                # build (if needed) and run
#   ./run.sh --rebuild      # force a fresh image build, then run
#   ./run.sh --logs         # follow logs of the running container
#   ./run.sh --stop         # stop and remove the container

set -euo pipefail

IMAGE_NAME="quint-avatar-tester"
CONTAINER_NAME="quint-avatar-tester"
HOST_PORT="4321"
CONTAINER_PORT="4321"
DATA_VOLUME="quint-avatar-data"

info()  { printf '\033[1;34m▸\033[0m %s\n' "$1"; }
error() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; }

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    error "Docker is not installed or not on PATH. Install Docker Desktop first."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running. Start Docker Desktop and retry."
    exit 1
  fi
}

stop_container() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    info "Stopping and removing existing container '$CONTAINER_NAME'..."
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi
}

case "${1:-}" in
  --stop)
    require_docker
    stop_container
    info "Stopped."
    exit 0
    ;;
  --logs)
    require_docker
    docker logs -f "$CONTAINER_NAME"
    exit 0
    ;;
esac

require_docker

# .env is required — the app reads provider keys from it. Never commit it.
if [[ ! -f .env ]]; then
  error "No .env file found. Copy .env.example to .env and fill in the API keys."
  exit 1
fi

# Build the image if it is missing or --rebuild was passed.
if [[ "${1:-}" == "--rebuild" ]] || ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  info "Building image '$IMAGE_NAME' (this can take a few minutes the first time)..."
  docker build -t "$IMAGE_NAME" .
else
  info "Reusing existing image '$IMAGE_NAME' (pass --rebuild to force a fresh build)."
fi

stop_container

# Docker-managed named volume that backs the SQLite file, so data persists
# across runs. Docker creates it on first use; no host directory needed.
info "Starting container on http://localhost:${HOST_PORT} ..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --env-file .env \
  -e DATABASE_PATH=/data/interviews.db \
  -v "$DATA_VOLUME:/data" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  "$IMAGE_NAME" >/dev/null

info "Up. App at http://localhost:${HOST_PORT}"
info "Follow logs with:  ./run.sh --logs"
info "Stop with:         ./run.sh --stop"
