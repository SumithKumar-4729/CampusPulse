#!/usr/bin/env bash
set -euo pipefail

# Quick reference:
# - Start backend: ./startup.sh
# - Start backend + install deps: ./startup.sh --install
# - Start backend + Android emulator: ./startup.sh --emulator
# - Start all (deps + backend + emulator): ./startup.sh --install --emulator
# - Open Postgres shell:
#   docker exec -it geo-postgres psql -U admin -d attendance_db

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

INSTALL_DEPS=false
START_EMULATOR=false

for arg in "$@"; do
  case "$arg" in
    --install)
      INSTALL_DEPS=true
      ;;
    --emulator)
      START_EMULATOR=true
      ;;
    *)
      echo "[startup] Unknown option: $arg"
      echo "[startup] Supported options: --install --emulator"
      exit 1
      ;;
  esac
done

if [[ ! -x "./venv/bin/python3" ]] && [[ ! -x "../venv/bin/python3" ]]; then
  echo "[startup] Missing Python in ./venv or ../venv. Create venv first."
  exit 1
fi

VENV_BIN="./venv/bin/python3"
if [[ -x "../venv/bin/python3" ]]; then
  VENV_BIN="../venv/bin/python3"
fi

if [[ "${INSTALL_DEPS}" == "true" ]]; then
  echo "[startup] Installing/updating Python dependencies..."
  ${VENV_BIN} -m pip install -r requirements.txt
fi

if [[ "${START_EMULATOR}" == "true" ]]; then
  if command -v adb >/dev/null 2>&1 && command -v emulator >/dev/null 2>&1; then
    if adb devices | grep -q "emulator-"; then
      echo "[startup] Android emulator already running."
    else
      AVD_NAME="$(emulator -list-avds | head -n 1 || true)"
      if [[ -n "${AVD_NAME}" ]]; then
        echo "[startup] Starting Android emulator: ${AVD_NAME}"
        nohup emulator -avd "${AVD_NAME}" >/tmp/android-emulator.log 2>&1 &
      else
        echo "[startup] No AVD found. Create an emulator in Android Studio first."
      fi
    fi
  else
    echo "[startup] adb/emulator command not found in PATH. Skipping emulator start."
  fi
fi

echo "[startup] Starting PostgreSQL container (geo-postgres)..."
docker start geo-postgres >/dev/null || true

echo "[startup] Launching backend server on http://127.0.0.1:8000"
exec ${VENV_BIN} -m uvicorn backend.app.main:app --reload
