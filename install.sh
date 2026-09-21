#!/usr/bin/env bash
# ===========================================================================
# AKILA Desktop Agent — Universal Installer
# ===========================================================================
# Installs the AKILA Desktop Agent without requiring code-signing/notarization.
#
# Usage:
#   curl -fsSL https://Woka21.github.io/akila/install.sh | bash
#
# What this script does:
#   1. Detects your platform (macOS / Windows / Linux)
#   2. Downloads the appropriate bundle from GitHub Releases
#   3. Verifies download integrity via SHA-256 checksum
#   4. Installs the app to the appropriate location
#   5. Removes quarantine flags (macOS only) so Gatekeeper doesn't block it
#   6. Launches the app
#
# To inspect before running:
#   curl -fsSL https://Woka21.github.io/akila/install.sh | less
#
# To uninstall:
#   rm -rf ~/Applications/AKILA\ Desktop\ Agent.app   (macOS)
#   # Windows: uninstall via Settings → Apps
#   # Linux: rm -rf ~/.local/bin/akila-desktop-agent  (AppImage location)
# ===========================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REPO="Woka21/akila"
RELEASE_TAG="latest"

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
    echo "  ╔══════════════════════════════════════════════╗"
    echo "  ║   🛡️  AKILA Desktop Agent — Installer       ║"
    echo "  ╚══════════════════════════════════════════════╝"
    printf "${RESET}"
    echo ""
}

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "${OS}" in
        Darwin)
            PLATFORM="macos"
            case "${ARCH}" in
                arm64)  info "Platform: macOS (Apple Silicon)" ;;
                x86_64) info "Platform: macOS (Intel)" ;;
                *)      warn "Unknown architecture: ${ARCH} — proceeding anyway" ;;
            esac
            ;;
        Linux)
            PLATFORM="linux"
            ARCH="${ARCH}"
            info "Platform: Linux (${ARCH})"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            PLATFORM="windows"
            info "Platform: Windows"
            ;;
        *)
            fail "Unsupported platform: ${OS}. This installer supports macOS, Linux, and Windows."
            ;;
    esac

    MACOS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo 'n/a')"
    if [ "${MACOS_VERSION}" != "n/a" ]; then
        info "macOS version: ${MACOS_VERSION}"
    fi
}

# ---------------------------------------------------------------------------
# Download with checksum verification
# ---------------------------------------------------------------------------
download_base_url() {
    if [ "${RELEASE_TAG}" = "latest" ]; then
        echo "https://github.com/${REPO}/releases/latest/download"
    else
        echo "https://github.com/${REPO}/releases/download/${RELEASE_TAG}"
    fi
}

download_and_verify() {
    local asset_name="$1"
    local base_url
    base_url="$(download_base_url)"

    local zip_path="${TMPDIR_INSTALL}/${asset_name}"
    local sha_path="${TMPDIR_INSTALL}/${asset_name}.sha256"
    local download_url="${base_url}/${asset_name}"
    local checksum_url="${base_url}/${asset_name}.sha256"

    echo ""
    info "Downloading ${asset_name}..."
    info "      From: ${download_url}"

    if ! curl -fSL --progress-bar -o "${zip_path}" "${download_url}"; then
        fail "Download failed. Check your internet connection and that the release exists at:"
        fail "  https://github.com/${REPO}/releases"
    fi

    local size_mb
    size_mb="$(du -m "${zip_path}" | awk '{print $1}')"
    success "Downloaded (${size_mb} MB)"

    echo ""
    info "Verifying integrity..."
    if curl -fsSL -o "${sha_path}" "${checksum_url}" 2>/dev/null; then
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

    DOWNLOAD_PATH="${zip_path}"
}

# ---------------------------------------------------------------------------
# macOS install
# ---------------------------------------------------------------------------
install_macos() {
    local app_name="AKILA Desktop Agent"
    local install_dir="${HOME}/Applications"

    echo ""
    info "[3/4] Installing to ${install_dir}..."
    mkdir -p "${install_dir}"

    unzip -qo "${DOWNLOAD_PATH}" -d "${TMPDIR_INSTALL}/extract"

    local app_path
    app_path="$(find "${TMPDIR_INSTALL}/extract" -maxdepth 2 -name '*.app' -type d -print -quit)"

    if [ -z "${app_path}" ]; then
        fail "Could not find .app bundle in the downloaded archive."
    fi

    # Remove quarantine attribute BEFORE moving to Applications
    xattr -rd com.apple.quarantine "${app_path}" 2>/dev/null || true

    if [ -d "${install_dir}/${app_name}.app" ]; then
        warn "Existing installation found — replacing."
        rm -rf "${install_dir}/${app_name}.app"
    fi

    mv -f "${app_path}" "${install_dir}/${app_name}.app"

    local binary="${install_dir}/${app_name}.app/Contents/MacOS"
    if [ -d "${binary}" ]; then
        chmod +x "${binary}"/* 2>/dev/null || true
    fi

    success "Installed to: ${install_dir}/${app_name}.app"
    INSTALL_PATH="${install_dir}/${app_name}.app"
}

# ---------------------------------------------------------------------------
# Windows install
# ---------------------------------------------------------------------------
install_windows() {
    local msi_name="AKILA-Desktop-Agent-Windows.msi"

    echo ""
    info "[3/4] Installing AKILA Desktop Agent via MSI..."

    # Install the MSI directly
    if command -v winget >/dev/null 2>&1; then
        winget install --id AKILA.DesktopAgent --silent "${MSI_PATH}" 2>/dev/null || true
    fi

    # Use msiexec to install silently
    msiexec /i "${MSI_PATH}" /quiet /norestart 2>/dev/null ||
        msiexec /i "${MSI_PATH}" /qn 2>/dev/null ||
        warn "MSI installation may require administrator privileges. Please run as administrator or use winget."

    INSTALL_PATH="${MSI_PATH}"
    success "Installed to: ${INSTALL_PATH}"
}

# ---------------------------------------------------------------------------
# Linux install
# ---------------------------------------------------------------------------
install_linux() {
    local install_dir="${HOME}/.local/bin"
    local app_name="AKILA-Desktop-Agent-Linux.AppImage"

    echo ""
    info "[3/4] Installing to ${install_dir}..."
    mkdir -p "${install_dir}"

    # AppImage is downloaded directly (not zipped)
    chmod +x "${DOWNLOAD_PATH}"
    cp "${DOWNLOAD_PATH}" "${install_dir}/${app_name}"

    success "Installed to: ${install_dir}/${app_name}"
    INSTALL_PATH="${install_dir}/${app_name}"
}

# ---------------------------------------------------------------------------
# Launch
# ---------------------------------------------------------------------------
launch_app() {
    echo ""
    info "[4/4] Launching AKILA Desktop Agent..."

    case "${PLATFORM}" in
        macos)
            if open "${INSTALL_PATH}" 2>/dev/null; then
                success "AKILA launched!"
            else
                warn "Could not auto-launch. Open it manually from: ${INSTALL_PATH}"
            fi
            ;;
        linux)
            nohup "${INSTALL_PATH}" >/dev/null 2>&1 &
            sleep 2
            if pgrep -f "AKILA-Desktop-Agent" >/dev/null 2>&1; then
                success "AKILA launched!"
            else
                warn "Could not auto-launch. Run it manually from: ${INSTALL_PATH}"
            fi
            ;;
        windows)
            start "" "${INSTALL_PATH}"
            success "AKILA launched!"
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    printf "${BOLD}${GREEN}"
    echo "  ╔══════════════════════════════════════════════╗"
    echo "  ║   ✅ Installation Complete!                  ║"
    echo "  ╚══════════════════════════════════════════════╝"
    printf "${RESET}"
    echo ""
    info "Location:  ${INSTALL_PATH}"
    info "Server:    http://127.0.0.1:5001 (auto-started by the app)"
    echo ""
    printf "${BOLD}Next step:${RESET} Install the Chrome extension.\n"
    echo "  The app will guide you, or follow the manual steps at:"
    echo "  https://Woka21.github.io/akila/#extension"
    echo ""

    case "${PLATFORM}" in
        macos)
            info "To uninstall:"
            echo "  rm -rf ~/Applications/AKILA\\ Desktop\\ Agent.app"
            ;;
        linux)
            info "To uninstall:"
            echo "  rm -f ~/.local/bin/AKILA-Desktop-Agent-Linux.AppImage"
            ;;
        windows)
            info "To uninstall:"
            echo "  Run: msiexec /x AKILA-Desktop-Agent.msi /quiet"
            echo "  Or: Settings → Apps → AKILA Desktop Agent → Uninstall"
            ;;
    esac
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    header
    detect_platform

    TMPDIR_INSTALL="$(mktemp -d)"
    trap 'rm -rf "${TMPDIR_INSTALL}"' EXIT

    case "${PLATFORM}" in
        macos)
            download_and_verify "AKILA-Desktop-Agent-macOS.zip"
            install_macos
            ;;
        windows)
            download_and_verify "AKILA-Desktop-Agent-Windows.msi"
            MSI_PATH="${DOWNLOAD_PATH}"
            install_windows
            ;;
        linux)
            download_and_verify "AKILA-Desktop-Agent-Linux.AppImage"
            install_linux
            ;;
    esac

    launch_app
    print_summary
}

main
