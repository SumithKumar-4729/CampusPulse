#!/usr/bin/env bash
set -euo pipefail

# Starts the backend with a stable interpreter path and optional DB startup.

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

HOST="0.0.0.0"
PORT="8000"
RELOAD="true"
START_DB="true"
CHECK_ONLY="false"

for arg in "$@"; do
  case "$arg" in
    --no-db)
      START_DB="false"
      ;;
    --no-reload)
      RELOAD="false"
      ;;
    --check)
      CHECK_ONLY="true"
      ;;
    --help|-h)
      echo "Usage: ./startup.sh [--no-db] [--no-reload] [--check]"
      echo "  --no-db      Do not attempt to start geo-postgres container"
      echo "  --no-reload  Start uvicorn without auto-reload"
      echo "  --check      Validate environment and exit"
      exit 0
      ;;
    *)
      echo "[startup] Unknown option: $arg"
      echo "[startup] Use --help for usage"
      exit 1
      ;;
  esac
done

if [[ -x "./.venv/bin/python" ]]; then
  PYTHON_BIN="./.venv/bin/python"
elif [[ -x "../venv/bin/python3" ]]; then
  PYTHON_BIN="../venv/bin/python3"
else
  echo "[startup] Python venv not found. Expected one of:"
  echo "[startup]   ./.venv/bin/python"
  echo "[startup]   ../venv/bin/python3"
  exit 1
fi

if [[ "${START_DB}" == "true" ]]; then
  if command -v docker >/dev/null 2>&1; then
    echo "[startup] Ensuring PostgreSQL container is running (geo-postgres)..."
    docker start geo-postgres >/dev/null 2>&1 || true
  else
    echo "[startup] docker not found; skipping DB container start"
  fi
fi

if [[ "${CHECK_ONLY}" == "true" ]]; then
  echo "[startup] Python: ${PYTHON_BIN}"
  "${PYTHON_BIN}" -m uvicorn --version >/dev/null
  echo "[startup] Check passed"
  exit 0
fi

echo "[startup] Starting backend at http://${HOST}:${PORT}"
if [[ "${RELOAD}" == "true" ]]; then
  exec "${PYTHON_BIN}" -m uvicorn app.main:app --reload --host "${HOST}" --port "${PORT}"
else
  exec "${PYTHON_BIN}" -m uvicorn app.main:app --host "${HOST}" --port "${PORT}"
fi





#docker exec -it geo-postgres psql -U admin -d attendance_db