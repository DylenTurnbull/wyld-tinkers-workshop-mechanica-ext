#!/usr/bin/env bash
set -eu

EXTENSION_ID="wyld-tinkers-workshop-mechanica-export"
EXTENSION_FILENAME="${EXTENSION_ID}.ts"
SOURCE_RELATIVE="extensions/mechanica-export.ts"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

expand_tilde() {
  case "$1" in
    '~') printf '%s\n' "$HOME" ;;
    '~/'*) printf '%s/%s\n' "$HOME" "${1#~/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

same_file() {
  [ -e "$1" ] && [ -e "$2" ] && [ "$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")" = "$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")" ]
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
source_file="$repo_root/$SOURCE_RELATIVE"

[ -f "$source_file" ] || fail "Extension source not found: $source_file"

pi_bin=$(command -v pi 2>/dev/null || true)
[ -n "$pi_bin" ] || fail "Pi is not installed or not on PATH. Install @mariozechner/pi-coding-agent first."

node_bin=$(command -v node 2>/dev/null || true)
[ -n "$node_bin" ] || fail "node is required to inspect the installed Pi package."

pi_root=$(
  "$node_bin" - "$pi_bin" <<'NODE'
const fs = require('fs');
const path = require('path');
const piBin = process.argv[2];
let current = fs.realpathSync(piBin);
if (fs.statSync(current).isFile()) current = path.dirname(current);
while (true) {
  const pkgPath = path.join(current, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name === '@mariozechner/pi-coding-agent') {
        console.log(current);
        process.exit(0);
      }
    } catch {}
  }
  const parent = path.dirname(current);
  if (parent === current) break;
  current = parent;
}
process.exit(1);
NODE
) || fail "Could not locate installed @mariozechner/pi-coding-agent source from: $pi_bin"

[ -f "$pi_root/README.md" ] || fail "Installed Pi README not found at $pi_root/README.md"
[ -f "$pi_root/docs/extensions.md" ] || fail "Installed Pi docs not found at $pi_root/docs/extensions.md"
[ -f "$pi_root/dist/config.js" ] || fail "Installed Pi config source not found at $pi_root/dist/config.js"
[ -f "$pi_root/dist/core/extensions/loader.js" ] || fail "Installed Pi extension loader source not found at $pi_root/dist/core/extensions/loader.js"

grep -Fq '~/.pi/agent/extensions/*.ts' "$pi_root/docs/extensions.md" || fail "Installed Pi docs do not document global extensions/*.ts auto-discovery."
grep -Fq '~/.pi/agent/extensions/*/index.ts' "$pi_root/docs/extensions.md" || fail "Installed Pi docs do not document global extensions/*/index.ts auto-discovery."
grep -Fq 'path.join(agentDir, "extensions")' "$pi_root/dist/core/extensions/loader.js" || fail "Installed Pi source does not appear to auto-discover agentDir/extensions."

if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
  agent_dir=$(expand_tilde "$PI_CODING_AGENT_DIR")
  log "Using PI_CODING_AGENT_DIR: $agent_dir"
else
  grep -Fq 'PI_CODING_AGENT_DIR' "$pi_root/README.md" || fail "Installed Pi README does not document PI_CODING_AGENT_DIR."
  grep -Fq 'default: `~/.pi/agent`' "$pi_root/README.md" || fail "Installed Pi README does not document the default ~/.pi/agent directory."
  grep -Fq 'return join(homedir(), CONFIG_DIR_NAME, "agent")' "$pi_root/dist/config.js" || fail "Installed Pi source does not define the default agent directory via getAgentDir()."
  agent_dir=$(
    "$node_bin" --input-type=module - "$pi_root/dist/config.js" <<'NODE'
const configPath = process.argv[2];
const config = await import(configPath);
console.log(config.getAgentDir());
NODE
  ) || fail "Could not derive Pi agent directory from installed Pi source."
  log "Using Pi default agent directory from installed source: $agent_dir"
fi

extensions_dir="$agent_dir/extensions"
target="$extensions_dir/$EXTENSION_FILENAME"

mkdir -p "$extensions_dir"

if [ -L "$target" ]; then
  link_target=$(readlink "$target")
  case "$link_target" in
    /*) link_abs="$link_target" ;;
    *) link_abs="$extensions_dir/$link_target" ;;
  esac
  if same_file "$link_abs" "$source_file"; then
    log "Existing symlink already points to this repo extension; refreshing it."
  else
    fail "Refusing to replace existing symlink not owned by this repo: $target -> $link_target"
  fi
elif [ -e "$target" ]; then
  fail "Refusing to replace existing non-symlink extension: $target"
fi

ln -sfn "$source_file" "$target"

log "Installed Mechanica Pi extension symlink:"
log "  $target -> $source_file"
log "Run 'pi' from any project and use /mechanica-export. No -e flag is required after install."
