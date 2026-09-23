#!/bin/bash
# ===========================================================================
# AKILA Privilege Guard — Local Sanitization Server (macOS)
# ===========================================================================
# Double-click this file to install (once) and start the AKILA local server.
# It is safe to re-run at any time: everything is idempotent.
#
# What it does:
#   1. Finds a suitable Python 3 on this Mac (needs 3.10 or newer)
#   2. Creates a private Python environment (venv/) the first time
#   3. Installs the AKILA dependencies + the ~600 MB language model (first run only)
#   4. Starts the server on http://127.0.0.1:5001 and leaves it running
#
# If the first run is slow, that is the model downloading — normal.
# When you see "Running on http://127.0.0.1:5001", the server is up.
# ===========================================================================

cd "$(dirname "$0")" || exit 1

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BOLD=$'\033[1m'
NC=$'\033[0m'

echo
echo "${BOLD}AKILA Privilege Guard — local server (macOS)${NC}"
echo

# --- 1. Find Python 3 (3.10+) -------------------------------------------------
PYTHON=""
for cand in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  if command -v "$cand" >/dev/null 2>&1; then
    ver=$("$cand" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)
    major=${ver%%.*}
    minor=${ver##*.}
    if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then
      PYTHON="$cand"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "${RED}Python 3.10 or newer was not found on this Mac.${NC}"
  echo
  echo "Install the official build, then double-click this file again:"
  echo "  https://www.python.org/downloads/"
  echo
  open "https://www.python.org/downloads/"
  echo "${YELLOW}The download page has been opened in your browser.${NC}"
  echo
  read -rsp "Press Enter to close this window..." unused
  exit 1
fi

echo "Using Python: $("$PYTHON" --version) at $PYTHON"

# --- 2. Create the private Python environment ---------------------------------
if [ ! -d "venv" ]; then
  echo
  echo "${YELLOW}First run: setting up the private Python environment...${NC}"
  "$PYTHON" -m venv venv
  if [ $? -ne 0 ]; then
    echo "${RED}Could not create the Python environment. Install Python 3.10+ from"
    echo "https://www.python.org/downloads/ and double-click this file again.${NC}"
    read -rsp "Press Enter to close this window..." unused
    exit 1
  fi
fi

# --- 3. Install dependencies (idempotent — fast once installed) ----------------
echo
echo "Installing/checking dependencies (this can take a few minutes the first time)..."
venv/bin/python -m pip install --quiet --upgrade pip
venv/bin/python -m pip install --quiet -r server/requirements.txt
if [ $? -ne 0 ]; then
  echo
  echo "${RED}Dependency installation failed. Check your internet connection and try again.${NC}"
  read -rsp "Press Enter to close this window..." unused
  exit 1
fi

# --- 4. Language model (one-time ~600 MB download) ----------------------------
if venv/bin/python -c 'import en_core_web_lg' 2>/dev/null; then
  echo "Language model: already installed."
else
  echo
  echo "${YELLOW}Downloading the language model (~600 MB) — first run only.${NC}"
  venv/bin/python -m spacy download en_core_web_lg
  if [ $? -ne 0 ]; then
    echo
    echo "${RED}Language model download failed. Check your connection and re-run.${NC}"
    read -rsp "Press Enter to close this window..." unused
    exit 1
  fi
fi

# --- 5. Start the server -------------------------------------------------------
echo
echo "${GREEN}Starting the AKILA server...${NC}"
echo "${BOLD}Keep this window open — closing it stops the server.${NC}"
echo
exec venv/bin/python server/presidio_server.py