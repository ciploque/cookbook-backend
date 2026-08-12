#!/usr/bin/env bash
# Brings up the docker services and exposes the local server via ngrok.
#
# Usage:
#   npm run dev:tunnel          # postgres + meilisearch only (pair with `npm run dev` locally)
#   npm run dev:tunnel:build    # also builds and runs the containerized `app` service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"

BUILD=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--build]" >&2
      exit 1
      ;;
  esac
done

if [ "$BUILD" = true ]; then
  echo "==> Building and starting full stack (postgres, meilisearch, app)..."
  docker compose -f "$COMPOSE_FILE" up -d --build app
else
  echo "==> Starting infra services (postgres, meilisearch)..."
  docker compose -f "$COMPOSE_FILE" up -d postgres meilisearch
fi

echo "==> Starting ngrok tunnel on port 3001..."
exec ngrok http 3001
