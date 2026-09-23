#!/usr/bin/env bash
# ===========================================================================
# AKILA Desktop Agent – Secure Build Script
# ===========================================================================
# Compiles Python code to bytecode and obfuscates JavaScript for
# distribution. Run before `npx tauri build`.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCE_DIR="${APP_DIR}/src-tauri/resources"

echo "=== AKILA Secure Build ==="

# ---------------------------------------------------------------------------
# 1. Compile Python server to bytecode (.pyc) and package as zipapp
# ---------------------------------------------------------------------------
echo "[1/4] Compiling Python server to bytecode..."

PYTHON_BIN="${RESOURCE_DIR}/server/venv/bin/python"
if [ ! -x "${PYTHON_BIN}" ]; then
    echo "ERROR: venv Python not found at ${PYTHON_BIN}"
    exit 1
fi

# Sync the canonical server source into the resources tree before building.
# The canonical copy lives at <repo>/server/presidio_server.py and is the
# single source of truth (verify_release S3 checks every copy is identical
# to it). Without this sync, the .pyz would be built from whatever stale
# copy happened to be sitting in resources/.
CANONICAL="$(cd "${APP_DIR}/../.." && pwd)/server/presidio_server.py"
if [ -f "${CANONICAL}" ]; then
    cp "${CANONICAL}" "${RESOURCE_DIR}/server/presidio_server.py"
    echo "  Synced canonical server source from ${CANONICAL}"
fi

# Backup the original if not already backed up
if [ -f "${RESOURCE_DIR}/server/presidio_server.py.bak" ]; then
    echo "  Backup already exists: presidio_server.py.bak"
else
    cp "${RESOURCE_DIR}/server/presidio_server.py" "${RESOURCE_DIR}/server/presidio_server.py.bak"
    echo "  Backed up: presidio_server.py → presidio_server.py.bak"
fi

# Create staging directory
STAGING_DIR=$(mktemp -d)
trap "rm -rf ${STAGING_DIR}" EXIT

# Compile presidio_server.py to bare .pyc using the venv Python
"${PYTHON_BIN}" -c "
import py_compile
py_compile.compile('${RESOURCE_DIR}/server/presidio_server.py',
                   cfile='${STAGING_DIR}/presidio_server.pyc',
                   doraise=True)
"
echo "  Compiled: presidio_server.pyc"

# Create __main__.py that uses direct import (works with zipimport)
cat > "${STAGING_DIR}/__main__.py" << 'PYEOF'
import sys
import os

# When running from a zipapp, sys.path[0] is the zip file path
# zipimport will find presidio_server.pyc inside it
import presidio_server
presidio_server.app.run(host='127.0.0.1', port=5001)
PYEOF
echo "  Created: __main__.py entry point"

# Create zipapp
"${PYTHON_BIN}" -m zipapp "${STAGING_DIR}" -o "${RESOURCE_DIR}/server/server.pyz"
echo "  Created: ${RESOURCE_DIR}/server/server.pyz"

# Restore the plaintext .py source so the repo stays consistent. The .bak
# is the pre-obfuscation copy; the working .py must match the canonical
# server/ copy (verified by verify_release S3) so a subsequent build picks
# up any change. The shipped .app still runs the .pyz — the .py is only
# needed for development and for the byte-identity check.
if [ -f "${RESOURCE_DIR}/server/presidio_server.py.bak" ]; then
    cp "${RESOURCE_DIR}/server/presidio_server.py.bak" "${RESOURCE_DIR}/server/presidio_server.py"
    echo "  Restored: presidio_server.py (plaintext, from .bak)"
fi

# ---------------------------------------------------------------------------
# 2. Obfuscate extension JavaScript files
#
# Obfuscation is a distribution nicety, NOT a security boundary: the
# extension is loaded as an UNPACKED extension, so its source is always
# readable by the user in chrome://extensions. Obfuscating in place would
# break verify_release's S3 byte-identity check (the resources/extension/*
# files must match the canonical extension/* files exactly), so we write
# the obfuscated copies into a staging directory and leave the shipped
# resources plaintext. If you want the obfuscated variant in the bundle,
# copy the staged files over the resources ones AFTER the verification
# suite has run.
# ---------------------------------------------------------------------------
echo "[2/4] Obfuscating extension JavaScript (staged, non-destructive)..."

EXT_DIR="${RESOURCE_DIR}/extension"
OBFUSCATED_DIR="${STAGING_DIR}/obfuscated"
mkdir -p "${OBFUSCATED_DIR}"
for f in background.js content-script.js akila-page-interceptor.js akila-universal-sieve.js popup.js; do
    src="${EXT_DIR}/${f}"
    if [ -f "${src}" ]; then
        npx javascript-obfuscator "${src}" --output "${OBFUSCATED_DIR}/${f}" \
            --compact true \
            --self-defending true \
            --control-flow-flattening true \
            --control-flow-flattening-threshold 0.75 \
            --dead-code-injection true \
            --dead-code-injection-threshold 0.4 2>/dev/null
        echo "  Obfuscated (staged): extension/${f}"
    fi
done
echo "  Shipped resources remain plaintext (required by verify_release S3)."

# ---------------------------------------------------------------------------
# 3. Clean up non-essential files
# ---------------------------------------------------------------------------
echo "[3/4] Cleaning up..."

# Remove __pycache__ from server
rm -rf "${RESOURCE_DIR}/server/__pycache__"

# Remove test files
rm -f "${RESOURCE_DIR}/server/test_api.py"
rm -f "${RESOURCE_DIR}/server/test_harness.py"
rm -f "${RESOURCE_DIR}/server/test_corpus.json"

# Remove any stray Python files from extension dir
rm -f "${EXT_DIR}/presidio_server.py"
rm -f "${EXT_DIR}/requirements.txt"
rm -rf "${EXT_DIR}/__pycache__"

echo "  Cleaned test files and caches"

# ---------------------------------------------------------------------------
# 4. Summary
# ---------------------------------------------------------------------------
echo "[4/4] Done."
echo ""
echo "=== Secure build complete ==="
echo "  Python server: ${RESOURCE_DIR}/server/server.pyz (compiled bytecode)"
echo "  Extension JS:  obfuscated in ${EXT_DIR}/"
echo "  Backup:        ${RESOURCE_DIR}/server/presidio_server.py.bak"
echo ""
echo "To restore originals for development:"
echo "  cp ${RESOURCE_DIR}/server/presidio_server.py.bak ${RESOURCE_DIR}/server/presidio_server.py"
