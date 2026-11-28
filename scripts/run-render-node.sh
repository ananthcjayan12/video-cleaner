#!/bin/bash
# Starts this computer as a PractiReel render computer (see docs/SETUP-render-computer.md).
# Settings come from ~/.practireel-node.env (mode 600):
#   PRACTIREEL_HUB_URL=https://editor.srshti.co.in
#   PRACTIREEL_NODE_TOKEN=prn_...
#   PRACTIREEL_NODE_NAME=MacBook
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${PRACTIREEL_NODE_ENV:-$HOME/.practireel-node.env}"
if [ ! -f "$ENV_FILE" ]; then echo "Missing $ENV_FILE (hub URL, token, name)" >&2; exit 1; fi
set -a; . "$ENV_FILE"; set +a
export NODE_ENV=production PORT="${PORT:-3011}" VIDEO_CLEANER_NO_RESUME=1
# Homebrew (Apple Silicon and Intel) and user-local tools first.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if [ "$(uname)" = "Darwin" ]; then exec /usr/bin/caffeinate -is node dist-server/index.js; fi  # keep the Mac awake while it is a render computer
exec node dist-server/index.js
