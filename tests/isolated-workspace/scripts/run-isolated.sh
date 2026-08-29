#!/usr/bin/env bash
set -euo pipefail
# ponytail: minimal isolated runner — HOME override prevents global plugin pollution, dataDir stays in .data

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="$ROOT/.home"
mkdir -p "$HOME_DIR"
mkdir -p "$ROOT/.data" "$ROOT/.capture" "$ROOT/docs"

# ponytail: clean HOME, no global opencode config, no global MCPs — only tests/isolated-workspace/opencode.json
export HOME="$HOME_DIR"
export XDG_CONFIG_HOME="$HOME_DIR/.config"
export XDG_DATA_HOME="$HOME_DIR/.local/share"
export OPENCODE_CONFIG_DIR="$HOME_DIR/.config/opencode"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"

echo "[isolated] HOME=$HOME"
echo "[isolated] opencode config: $ROOT/opencode.json"
cat "$ROOT/opencode.json"
echo ""
echo "[isolated] dataDir: $ROOT/.data"
echo "[isolated] running: $ROOT/node_modules/.bin/opencode2 --help"
if [ -x "$ROOT/node_modules/.bin/opencode2" ]; then
  "$ROOT/node_modules/.bin/opencode2" --version
  echo ""
  echo "Starting opencode2 TUI in isolated mode..."
  echo "Tip: ask 'Create a docx at $ROOT/docs/hello.docx with Hello world'"
  exec "$ROOT/node_modules/.bin/opencode2" "$@"
else
  echo "Missing local opencode2 — run: cd $ROOT && bun install && bun pm trust @opencode-ai/cli"
  exit 1
fi
