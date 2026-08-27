#!/usr/bin/env bash
set -e
# ponytail: global file edit, per-project config if opencode.json exists else global — no daemon, no dep beyond node+bash

PLUGIN="@xirothedev/openoffice-plugin-opencode"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_SRC="$SCRIPT_DIR/skills/office"
usage(){ cat <<'USAGE'
Usage: ./install.sh [--global] [--project DIR] [--local] [--skill-only] [--plugin-only] [--help]
  --global      install to ~/.config/opencode (default: project ./opencode.json if exists else global)
  --project DIR project dir (default: .)
  --local       link local build (bun link --global) instead of npm
  --skill-only  only install skill
  --plugin-only only install plugin
USAGE
}

GLOBAL=0; PROJECT="."; LOCAL=0; SKILL_ONLY=0; PLUGIN_ONLY=0
while [ $# -gt 0 ]; do case "$1" in
  --global) GLOBAL=1; shift ;;
  --project) PROJECT="$2"; shift 2 ;;
  --local) LOCAL=1; shift ;;
  --skill-only) SKILL_ONLY=1; shift ;;
  --plugin-only) PLUGIN_ONLY=1; shift ;;
  --help|-h) usage; exit 0 ;;
  *) echo "unknown arg $1"; usage; exit 1 ;;
esac; done

# decide target dir
if [ "$GLOBAL" -eq 1 ]; then TARGET="$HOME/.config/opencode"
else
  if [ -f "$PROJECT/opencode.json" ] || [ -f "$PROJECT/opencode.jsonc" ]; then TARGET="$PROJECT"
  elif [ "$PROJECT" != "." ]; then TARGET="$PROJECT"
  else TARGET="$HOME/.config/opencode"; echo "no ./opencode.json, using global $TARGET"
  fi
fi
mkdir -p "$TARGET"

# pandoc hint (non-fatal)
if ! command -v pandoc >/dev/null 2>&1; then echo "warn: pandoc not found — DOCX/XLSX/PPTX write needs pandoc (brew install pandoc)"; fi

# --- plugin ---
if [ "$SKILL_ONLY" -eq 0 ]; then
  if [ -f "$TARGET/opencode.jsonc" ]; then CFG="$TARGET/opencode.jsonc"
  else CFG="$TARGET/opencode.json"; fi
  [ -f "$CFG" ] || echo '{"plugins":[]}' > "$CFG"
  PKG="$PLUGIN"
  # ponytail: one node line edits plugins array, idempotent — jq if available would be smaller but node is stdlib
  node -e '
    const fs=require("fs"), p=process.argv[1], pkg=process.argv[2];
    const raw=fs.readFileSync(p,"utf8").replace(/\/\/.*$/gm,"").replace(/\/\*[\s\S]*?\*\//g,"");
    const j=JSON.parse(raw);
    j.plugins=j.plugins||[];
    const found=j.plugins.some(x=> (typeof x==="string"?x:x.package)===pkg);
    if(!found) j.plugins.push(pkg);
    fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
    console.log("plugin →", p, ":", pkg);
  ' "$CFG" "$PKG"
  if [ "$LOCAL" -eq 1 ]; then
    echo "local: linking plugin via bun link"
    (cd "$SCRIPT_DIR" && bun link --global 2>&1 | tail -n 5 || echo "bun link failed — ensure bun is installed")
    (cd "$TARGET" && bun link "$PLUGIN" --global 2>&1 | tail -n 5 || echo "hint: cd $TARGET && bun link $PLUGIN --global")
  fi
fi

# --- skill ---
if [ "$PLUGIN_ONLY" -eq 0 ]; then
  if [ ! -d "$SKILL_SRC" ]; then echo "skill src $SKILL_SRC not found"; exit 1; fi
  # opencode skills: project .opencode/skills/office, global ~/.config/opencode/skills/office
  if [ "$TARGET" = "$HOME/.config/opencode" ]; then SKILL_DST="$TARGET/skills/office"
  else SKILL_DST="$TARGET/.opencode/skills/office"; fi
  mkdir -p "$(dirname "$SKILL_DST")"
  rm -rf "$SKILL_DST"
  cp -R "$SKILL_SRC" "$SKILL_DST"
  echo "skill → $SKILL_DST"
fi

echo "done. restart opencode2 and try: Create a Word document at /tmp/test.docx"
echo "verify: opencode2 api get /api/plugin | grep openoffice"
