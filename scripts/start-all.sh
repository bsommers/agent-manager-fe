#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "🚀 Starting AI Agent Manager (Backend + Frontend)..."

cleanup() {
  echo ""
  echo "🛑 Stopping servers..."
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

"$DIR/scripts/start-backend.sh" &
BACKEND_PID=$!

sleep 2

"$DIR/scripts/start-frontend.sh" &
FRONTEND_PID=$!

wait $BACKEND_PID $FRONTEND_PID
