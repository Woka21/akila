#!/usr/bin/env bash
# ===========================================================================
# AKILA Desktop Agent – Build Script (Tauri 2.x)
# ===========================================================================
# Builds the Tauri desktop application into platform-specific installers.
# Usage: cd src-tauri/akila-desktop-agent && ./build-desktop-agent.sh
#
# Prerequisites:
#   - Rust toolchain (rustup/cargo)
#   - npm + node
#   - Platform-specific signing identities (for macOS/Windows codesigning)
# ===========================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(m.version)' "${APP_DIR}/src-tauri/resources/extension/manifest.json")

echo "=== AKILA Desktop Agent Build ==="
echo "  Version: ${VERSION}"
echo "  App dir: ${APP_DIR}"

# Check prerequisites
command -v cargo >/dev/null 2>&1 || { echo "ERROR: cargo not found. Install Rust: https://rustup.rs"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm not found."; exit 1; }

# Check for Apple signing identity (optional — builds with ad-hoc signing if absent)
APPLE_CERT_ID=""
if [ -n "${APPLE_CERT_ID:-}" ]; then
    echo "WARNING: Using Apple certificate from environment."
fi

# Check for notarization credentials (optional)
NOTARIZE=""
if [ -n "${AC_PASSWORD:-}" ] && [ -n "${APPLE_ID:-}" ]; then
    NOTARIZE="yes"
    echo "Notarization enabled (credentials found in environment)."
else
    echo "Notarization disabled (set APPLE_ID + AC_PASSWORD to enable)."
    echo "  The app will be ad-hoc signed. Users must right-click → Open to bypass Gatekeeper."
fi

# Install frontend dependencies
cd "${APP_DIR}"
echo "[1/4] Installing dependencies..."
npm install 2>/dev/null || { echo "WARNING: npm install had issues, continuing..."; }
# Build the Tauri application
echo ""
echo "[2/4] Compiling Python and obfuscating JS (secure build)..."
cd "${APP_DIR}"
./secure-build.sh

echo ""
echo "[3/4] Building Tauri application..."
if [ -n "${APPLE_CERT_ID:-}" ]; then
    npx tauri build -- -c apple -- -c "${APPLE_CERT_ID}" 2>&1 || npx tauri build 2>&1 || { echo "ERROR: Tauri build failed"; exit 1; }
else
    npx tauri build 2>&1 || { echo "ERROR: Tauri build failed"; exit 1; }
fi

# Notarize if credentials available
if [ "${NOTARATE:-}" = "yes" ]; then
    echo ""
    echo "[3.5/4] Notarizing macOS app..."
    DMG_PATH="$(find ${APP_DIR}/src-tauri/target/release/bundle -name '*.dmg' -print -quit)"
    if [ -n "${DMG_PATH}" ] && [ -f "${DMG_PATH}" ]; then
        xcrun notarytool submit "${DMG_PATH}" \
            --apple-id "${APPLE_ID}" \
            --password "${AC_PASSWORD}" \
            --team-id "${APPLE_TEAM_ID:-}" \
            --wait 2>&1 || echo "WARNING: Notarization failed — app will still work but may trigger Gatekeeper."
        # Staple the notarization ticket
        xcrun stapler staple "${DMG_PATH}" 2>&1 || true
        echo "  Notarization complete."
    fi
fi

# Collect output
echo ""
echo "[4/4] Collecting output..."
DIST_DIR="${ROOT}/dist-desktop"
mkdir -p "${DIST_DIR}"
if [ -d "${APP_DIR}/src-tauri/target/release/bundle" ]; then
    cp -r "${APP_DIR}/src-tauri/target/release/bundle/"* "${DIST_DIR}/" 2>/dev/null || true
fi

# Create SHA-256 checksums
if [ -d "${DIST_DIR}" ]; then
    cd "${DIST_DIR}"
    find . -type f \( -name "*.dmg" -o -name "*.msi" -o -name "*.deb" -o -name "*.rpm" -o -name "*.exe" -o -name "*.AppImage" \) -print0 | while IFS= read -r -d '' f; do
        shasum -a 256 "$f" > "${f}.sha256"
    done
fi

echo ""
echo "=== Build Complete ==="
echo "  Output: ${DIST_DIR}/"
if [ -d "${DIST_DIR}" ]; then
    ls -la "${DIST_DIR}/"
fi
echo "  NEVER include packaging/identities/ in the dist."
