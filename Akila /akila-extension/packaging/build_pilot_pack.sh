#!/usr/bin/env bash
# ===========================================================================
# AKILA Privilege Guard — Build the Pilot Pack
# ===========================================================================
# Assembles a clean, self-contained folder that a pilot partner unzips once:
#
#   dist/AKILA-PilotPack-v<version>/
#   ├── START-HERE.txt
#   ├── AKILA-Server.command   (macOS double-click)
#   ├── server-start.sh        (Linux/terminal)
#   ├── server-start.bat       (Windows)
#   ├── extension/             (5 runtime files only)
#   └── server/                (presidio_server.py + requirements.txt)
#
# then zips it and prints a checksum. Run:  packaging/build_pilot_pack.sh
#
# NEVER copies the private key (packaging/identities/) or dev-only files.
# ===========================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="$(pwd)"
VERSION="$(node -e 'const m=JSON.parse(require("fs").readFileSync("extension/manifest.json","utf8")); process.stdout.write(m.version)')"
PACKNAME="AKILA-PilotPack-v${VERSION}"
STAGE="${ROOT}/dist/${PACKNAME}"
DIST="${ROOT}/dist"

echo "== AKILA Pilot Pack build =="
echo "  package: ${PACKNAME}"
echo "  staging: ${STAGE}"

# Sanity checks ---------------------------------------------------------------
[ -f extension/manifest.json ] || { echo "missing extension/manifest.json"; exit 1; }
grep -q '"key"' extension/manifest.json || { echo "manifest has no pinned key — pack would not be pilot-ready"; exit 1; }
[ -f server/presidio_server.py ] || { echo "missing server/presidio_server.py"; exit 1; }

# Fresh staging area ----------------------------------------------------------
rm -rf "${STAGE}"
mkdir -p "${STAGE}/extension" "${STAGE}/server"

# Extension: only the runtime files -----------------------------------------
for f in manifest.json background.js content-script.js akila-page-interceptor.js \
         akila-universal-sieve.js popup.html popup.js; do
  cp "extension/${f}" "${STAGE}/extension/${f}"
done

# Server: code + pinned requirements ------------------------------------------
cp server/presidio_server.py "${STAGE}/server/presidio_server.py"
cp server/requirements.txt "${STAGE}/server/requirements.txt"

# Packaging scripts + quickstart ----------------------------------------------
cp packaging/START-HERE.txt "${STAGE}/START-HERE.txt"
cp packaging/AKILA-Server.command "${STAGE}/AKILA-Server.command"
cp packaging/server-start.sh "${STAGE}/server-start.sh"
cp packaging/server-start.bat "${STAGE}/server-start.bat"

chmod +x "${STAGE}/AKILA-Server.command" "${STAGE}/server-start.sh"

# Zip -------------------------------------------------------------------------
mkdir -p "${DIST}"
rm -f "${DIST}/${PACKNAME}.zip" "${DIST}/${PACKNAME}.zip.sha256"
(
  cd "${DIST}"
  zip -r -X -q "${PACKNAME}.zip" "${PACKNAME}" -x "*.DS_Store" -x ".*" -x "._*" -x "__MACOSX/*"
)

shasum -a 256 "${DIST}/${PACKNAME}.zip" | awk '{print $1}' > "${DIST}/${PACKNAME}.zip.sha256"

echo
echo "== Built: ${DIST}/${PACKNAME}.zip =="
echo
( cd "${DIST}" && /usr/bin/unzip -l "${PACKNAME}.zip" )
echo "SHA-256: $(cat "${DIST}/${PACKNAME}.zip.sha256")"
echo
echo "Send the .zip only. NEVER send packaging/identities/."

# Test the staged files are what we expect ------------------------------------
diff -u extension/manifest.json "${STAGE}/extension/manifest.json" >/dev/null && echo "manifest matched"
diff -u server/presidio_server.py "${STAGE}/server/presidio_server.py" >/dev/null && echo "server copy matched"