#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "⚡ Starting AI Agent Manager Backend Server..."
cd "$DIR/server"

if [ ! -d "node_modules" ]; then
  echo "📦 Installing server dependencies..."
  npm install
fi

exec npm run dev
