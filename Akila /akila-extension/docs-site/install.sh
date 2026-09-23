#!/usr/bin/env bash
# ===========================================================================
# AKILA Desktop Agent — macOS Installer
# ===========================================================================
# Installs the AKILA Desktop Agent without requiring Apple notarization.
#
# Usage:
#   curl -fsSL https://Woka21.github.io/akila/install.sh | bash
#
# What this script does:
#   1. Detects your macOS architecture (Apple Silicon / Intel)
#   2. Downloads the AKILA Desktop Agent from GitHub Releases
#   3. Verifies download integrity via SHA-256 checksum
#   4. Installs to ~/Applications (no admin/sudo required)
#   5. Clears the macOS quarantine flag so Gatekeeper doesn't block it
#   6. Launches the app
#
# To inspect before running:
#   curl -fsSL https://Woka21.github.io/akila/install.sh | less
#
# To uninstall:
#   rm -rf ~/Applications/AKILA\ Desktop\ Agent.app
# ===========================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REPO="Woka21/akila"
APP_NAME="AKILA Desktop Agent"
RELEASE_TAG="latest"
INSTALL_DIR="${HOME}/Applications"

# Asset names on GitHub Releases
ZIP_ASSET="AKILA-Desktop-Agent-macOS.zip"
SHA_ASSET="AKILA-Desktop-Agent-macOS.zip.sha256"

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
    BOLD="\033[1m"
    GREEN="\033[0;32m"
    YELLOW="\033[0;33m"
    RED="\033[0;31m"
    CYAN="\033[0;36m"
    RESET="\033[0m"
else
    BOLD="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
info()    { printf "${CYAN}▸${RESET} %s\n" "$*"; }
success() { printf "${GREEN}✅${RESET} %s\n" "$*"; }
warn()    { printf "${YELLOW}⚠️${RESET}  %s\n" "$*"; }
fail()    { printf "${RED}✖${RESET} %s\n" "$*" >&2; exit 1; }

header() {
    echo ""
    printf "${BOLD}${CYAN}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║   🛡️  AKILA Desktop Agent — Installer    ║"
    echo "  ╚══════════════════════════════════════════╝"
    printf "${RESET}"
    echo ""
}

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
preflight() {
    # Must be macOS
    if [ "$(uname -s)" != "Darwin" ]; then
        fail "This installer is for macOS only. For Linux, download the AppImage from GitHub Releases."
    fi

    # Need curl
    if ! command -v curl >/dev/null 2>&1; then
        fail "curl is required but not found."
    fi

    # Need unzip
    if ! command -v unzip >/dev/null 2>&1; then
        fail "unzip is required but not found."
    fi

    # Detect architecture
    ARCH="$(uname -m)"
    case "${ARCH}" in
        arm64)  info "Platform: macOS (Apple Silicon)" ;;
        x86_64) info "Platform: macOS (Intel)" ;;
        *)      warn "Unknown architecture: ${ARCH} — proceeding anyway" ;;
    esac

    # macOS version
    MACOS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo 'unknown')"
    info "macOS version: ${MACOS_VERSION}"
}

# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------
download_release() {
    local base_url

    if [ "${RELEASE_TAG}" = "latest" ]; then
        base_url="https://github.com/${REPO}/releases/latest/download"
    else
        base_url="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"
    fi

    TMPDIR_INSTALL="$(mktemp -d)"
    trap 'rm -rf "${TMPDIR_INSTALL}"' EXIT

    local zip_path="${TMPDIR_INSTALL}/${ZIP_ASSET}"
    local sha_path="${TMPDIR_INSTALL}/${SHA_ASSET}"

    echo ""
    info "[1/4] Downloading ${APP_NAME}..."
    info "      From: ${base_url}/${ZIP_ASSET}"

    if ! curl -fSL --progress-bar -o "${zip_path}" "${base_url}/${ZIP_ASSET}"; then
        fail "Download failed. Check your internet connection and that the release exists at:"
        fail "  https://github.com/${REPO}/releases"
    fi

    local size_mb
    size_mb="$(du -m "${zip_path}" | awk '{print $1}')"
    success "Downloaded (${size_mb} MB)"

    # Try to download checksum (non-fatal if missing)
    echo ""
    info "[2/4] Verifying integrity..."
    if curl -fsSL -o "${sha_path}" "${base_url}/${SHA_ASSET}" 2>/dev/null; then
        local expected actual
        expected="$(awk '{print $1}' "${sha_path}")"
        actual="$(shasum -a 256 "${zip_path}" | awk '{print $1}')"

        if [ "${expected}" != "${actual}" ]; then
            fail "SHA-256 checksum mismatch!"
            fail "  Expected: ${expected}"
            fail "  Got:      ${actual}"
            fail "The download may be corrupted or tampered with. Aborting."
        fi
        success "SHA-256 verified: ${actual:0:16}..."
    else
        warn "Checksum file not found — skipping verification."
        warn "To verify manually, compare with the checksum on the GitHub Release page."
    fi
}

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
install_app() {
    echo ""
    info "[3/4] Installing to ${INSTALL_DIR}..."

    # Create install directory
    mkdir -p "${INSTALL_DIR}"

    # Extract
    unzip -qo "${TMPDIR_INSTALL}/${ZIP_ASSET}" -d "${TMPDIR_INSTALL}/extract"

    # Find the .app bundle (may be nested in a folder)
    local app_path
    app_path="$(find "${TMPDIR_INSTALL}/extract" -maxdepth 2 -name '*.app' -type d -print -quit)"

    if [ -z "${app_path}" ]; then
        fail "Could not find .app bundle in the downloaded archive."
    fi

    # Remove quarantine attribute BEFORE moving to Applications
    # This prevents Gatekeeper from blocking the app since it's not notarized
    xattr -rd com.apple.quarantine "${app_path}" 2>/dev/null || true

    # Remove old installation if present
    if [ -d "${INSTALL_DIR}/${APP_NAME}.app" ]; then
        warn "Existing installation found — replacing."
        rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
    fi

    # Move to Applications
    mv -f "${app_path}" "${INSTALL_DIR}/${APP_NAME}.app"

    # Verify the binary is executable
    local binary="${INSTALL_DIR}/${APP_NAME}.app/Contents/MacOS"
    if [ -d "${binary}" ]; then
        chmod +x "${binary}"/* 2>/dev/null || true
    fi

    success "Installed to: ${INSTALL_DIR}/${APP_NAME}.app"
}

# ---------------------------------------------------------------------------
# Launch
# ---------------------------------------------------------------------------
launch_app() {
    echo ""
    info "[4/4] Launching ${APP_NAME}..."

    if open "${INSTALL_DIR}/${APP_NAME}.app" 2>/dev/null; then
        success "${APP_NAME} launched!"
    else
        warn "Could not auto-launch. Open it manually from: ${INSTALL_DIR}/${APP_NAME}.app"
    fi
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    printf "${BOLD}${GREEN}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║   ✅ Installation Complete!               ║"
    echo "  ╚══════════════════════════════════════════╝"
    printf "${RESET}"
    echo ""
    info "Location:  ${INSTALL_DIR}/${APP_NAME}.app"
    info "Server:    http://127.0.0.1:5001 (auto-started by the app)"
    echo ""
    printf "${BOLD}Next step:${RESET} Install the Chrome extension.\n"
    echo "  The app will guide you, or follow the manual steps at:"
    echo "  https://Woka21.github.io/akila/#extension"
    echo ""
    info "To uninstall:"
    echo "  rm -rf ~/Applications/AKILA\\ Desktop\\ Agent.app"
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    header
    preflight
    download_release
    install_app
    launch_app
    print_summary
}

# Wrap in main() so a partial download doesn't execute half the script
main
