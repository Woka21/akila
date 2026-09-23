#!/usr/bin/env bash
# ===========================================================================
# AKILA Privilege Guard — Local Sanitization Server (Linux/terminal)
# ===========================================================================
# Same behaviour as AKILA-Server.command, for Linux or for macOS users who
# prefer to run from a terminal. Run:
#     chmod +x server-start.sh
#     ./server-start.sh
# The first run downloads the ~600 MB language model — normal and one-time.
# ===========================================================================

set -e
cd "$(dirname "$0")"

echo
echo "AKILA Privilege Guard — local server"
echo

# --- 1. Find Python 3 (3.10+) ---
PYTHON=""
for cand in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then
    ver=$("$cand" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null) || continue
    major=${ver%%.*}
    minor=${ver##*.}
    if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then PYTHON="$cand"; break; fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "Python 3.10+ is required. Install it first: https://www.python.org/downloads/"
  exit 1
fi
echo "Using Python: $("$PYTHON" --version)"

# --- 2. Create venv ---
[ -d venv ] || "$PYTHON" -m venv venv

# --- 3. Dependencies ---
"$PYTHON" -m pip install --quiet --upgrade pip 2>/dev/null || true
venv/bin/python -m pip install --quiet -r server/requirements.txt

# --- 4. Language model (one-time) ---
if ! venv/bin/python -c 'import en_core_web_lg' 2>/dev/null; then
  echo "Downloading the language model (~600 MB) — first run only."
  venv/bin/python -m spacy download en_core_web_lg
fi

# --- 5. Start ---
echo "Starting the AKILA server on http://127.0.0.1:5001"
echo "Press Ctrl-C to stop."
exec venv/bin/python server/presidio_server.py