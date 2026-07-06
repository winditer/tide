#!/usr/bin/env bash
# ==========================================================================
# Tide A2A Bridge — installer for macOS & Linux
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
#
#   # Or from a local checkout:
#   bash scripts/install.sh
#
# Environment variables (optional):
#   BRIDGE_PORT         Port for the bridge server        (default: 8720)
#   BRIDGE_API_KEY      API key for authentication
#   SKIP_CLI_INSTALL    Set to 1 to skip npm CLI tools
# ==========================================================================
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*" >&2; }
header(){ echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }

# ── Platform detection ──────────────────────────────────────────────────────
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
    linux)  OS_NAME="Linux" ;;
    darwin) OS_NAME="macOS" ;;
    *)      fail "Unsupported OS: $OS"; exit 1 ;;
esac

echo ""
echo -e "  ${BLUE}Tide A2A Bridge Installer${NC}"
echo "  Platform: $OS_NAME ($ARCH)"
echo ""

# ── Helper: version compare ─────────────────────────────────────────────────
version_gte() {
    # Returns 0 if $1 >= $2 (semantic versioning)
    printf '%s\n%s' "$2" "$1" | sort -V -C 2>/dev/null
}

# ── Helper: detect package manager ──────────────────────────────────────────
detect_pkg_mgr() {
    if command -v brew &>/dev/null; then
        echo "brew"
    elif command -v apt-get &>/dev/null; then
        echo "apt"
    elif command -v dnf &>/dev/null; then
        echo "dnf"
    elif command -v yum &>/dev/null; then
        echo "yum"
    elif command -v pacman &>/dev/null; then
        echo "pacman"
    else
        echo "unknown"
    fi
}

PKG_MGR="$(detect_pkg_mgr)"

# ── 1. Git ──────────────────────────────────────────────────────────────────
header "Checking Git"
if command -v git &>/dev/null; then
    info "Git $(git --version | awk '{print $3}')"
else
    warn "Git not found, installing..."
    case "$PKG_MGR" in
        brew)   brew install git ;;
        apt)    sudo apt-get update -qq && sudo apt-get install -y -qq git ;;
        dnf)    sudo dnf install -y git ;;
        yum)    sudo yum install -y git ;;
        pacman) sudo pacman -Sy --noconfirm git ;;
        *)      fail "Cannot auto-install git. Please install manually."; exit 1 ;;
    esac
    info "Git installed"
fi

# ── 2. Python 3.11+ ────────────────────────────────────────────────────────
header "Checking Python"

PYTHON=""
for candidate in python3 python; do
    if command -v "$candidate" &>/dev/null; then
        ver="$($candidate -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
        if version_gte "$ver" "3.11"; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    warn "Python 3.11+ not found, installing..."
    case "$PKG_MGR" in
        brew)
            brew install python@3.12
            PYTHON="python3"
            ;;
        apt)
            sudo apt-get update -qq
            sudo apt-get install -y -qq software-properties-common
            sudo add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null || true
            sudo apt-get update -qq
            sudo apt-get install -y -qq python3.12 python3.12-venv python3-pip
            PYTHON="python3.12"
            ;;
        dnf)
            sudo dnf install -y python3.12
            PYTHON="python3.12"
            ;;
        *)
            fail "Cannot auto-install Python. Please install Python 3.11+ manually."
            exit 1
            ;;
    esac
    info "Python installed: $PYTHON"
else
    info "Python $($PYTHON --version)"
fi

# Ensure pip is available
if ! $PYTHON -m pip --version &>/dev/null; then
    warn "pip not found, installing..."
    $PYTHON -m ensurepip --upgrade 2>/dev/null || \
        curl -sS https://bootstrap.pypa.io/get-pip.py | $PYTHON
    info "pip installed"
fi

# ── 3. Node.js 20+ ─────────────────────────────────────────────────────────
header "Checking Node.js"

if command -v node &>/dev/null; then
    NODE_VER="$(node --version)"
    NODE_MAJOR="$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)"
    if [ "$NODE_MAJOR" -ge 20 ]; then
        info "Node.js $NODE_VER"
    else
        warn "Node.js $NODE_VER < v20, upgrading..."
        case "$PKG_MGR" in
            brew)
                brew install node@22
                brew link --overwrite node@22
                ;;
            apt)
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                sudo apt-get install -y -qq nodejs
                ;;
            dnf)
                curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
                sudo dnf install -y nodejs
                ;;
            *)
                fail "Cannot auto-upgrade Node.js. Please install v20+ manually."
                exit 1
                ;;
        esac
        info "Node.js upgraded"
    fi
else
    warn "Node.js not found, installing..."
    case "$PKG_MGR" in
        brew)   brew install node@22 ;;
        apt)
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y -qq nodejs
            ;;
        dnf)
            curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
            sudo dnf install -y nodejs
            ;;
        *)
            fail "Cannot auto-install Node.js. Please install v20+ manually."
            exit 1
            ;;
    esac
    info "Node.js installed"
fi

# ── 4. Agent CLI tools ─────────────────────────────────────────────────────
if [ "${SKIP_CLI_INSTALL:-0}" != "1" ]; then
    header "Checking Agent CLI tools"

    NPM="npm"
    if ! command -v "$NPM" &>/dev/null; then
        fail "npm not found. Please install Node.js properly."
        exit 1
    fi

    install_npm_cli() {
        local name="$1"
        shift
        if command -v "$name" &>/dev/null; then
            info "$name already installed: $(which "$name")"
        else
            warn "Installing $name..."
            if $NPM install -g --omit=optional --force "$@" 2>/dev/null; then
                info "$name installed"
            else
                warn "$name installation failed (will still continue)"
            fi
        fi
    }

    install_npm_cli "codex"  "@openai/codex"
    install_npm_cli "claude" "@anthropic-ai/claude-code"
    install_npm_cli "qoder"  "@qoder-ai/qodercli"
fi

# ── 5. Install A2A Bridge ──────────────────────────────────────────────────
header "Installing A2A Bridge"

# Determine install source: local (editable) or PyPI
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd || echo "")"

if [ -f "$PROJECT_DIR/pyproject.toml" ]; then
    info "Installing from local source: $PROJECT_DIR"
    $PYTHON -m pip install --quiet -e "$PROJECT_DIR"
else
    info "Installing from PyPI..."
    $PYTHON -m pip install --quiet tide-a2a-bridge
fi

if command -v a2a-bridge &>/dev/null; then
    info "a2a-bridge $(a2a-bridge --version 2>/dev/null || echo 'installed')"
else
    # pip install --user might put it in ~/.local/bin
    export PATH="$HOME/.local/bin:$PATH"
    if command -v a2a-bridge &>/dev/null; then
        info "a2a-bridge installed at $(which a2a-bridge)"
        warn "Added ~/.local/bin to PATH. Add this to your shell profile:"
        echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    else
        fail "a2a-bridge not found after installation."
        fail "Try: $PYTHON -m a2a_bridge --version"
    fi
fi

# ── 6. Default config ──────────────────────────────────────────────────────
header "Configuration"

CONFIG_DIR="$HOME/.a2a-bridge"
CONFIG_FILE="$CONFIG_DIR/.env"

if [ -f "$CONFIG_FILE" ]; then
    info "Config already exists: $CONFIG_FILE"
else
    mkdir -p "$CONFIG_DIR"
    cat > "$CONFIG_FILE" <<'ENVEOF'
# A2A Bridge Configuration — generated by installer
# Edit as needed, then run: a2a-bridge start

BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=8720
BRIDGE_PUBLIC_URL=
BRIDGE_API_KEY=
BRIDGE_WORK_DIR=~/workspace
BRIDGE_MAX_CONCURRENCY=5
BRIDGE_DEFAULT_TIMEOUT=600
BRIDGE_DEFAULT_AGENT=codex
BRIDGE_LOG_LEVEL=INFO

# LLM API Keys (uncomment and fill in)
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=

# Git Integration (optional)
GIT_REPOS_DIR=/tmp/a2a-repos
GIT_DEFAULT_BRANCH=main
GIT_AUTO_PUSH=true
# GIT_DEFAULT_REPO=
# GIT_AUTH_TOKEN=
# GIT_SSH_KEY_PATH=
ENVEOF
    info "Default config written to $CONFIG_FILE"
fi

# ── 7. System service (optional) ───────────────────────────────────────────
header "System Service"

if [ "$OS" = "linux" ] && command -v systemctl &>/dev/null; then
    read -r -p "  Register systemd user service? [y/N] " REG_SVC
    if [[ "$REG_SVC" =~ ^[yY]$ ]]; then
        BRIDGE_BIN="$(command -v a2a-bridge || echo "$PYTHON -m a2a_bridge")"
        UNIT_DIR="$HOME/.config/systemd/user"
        mkdir -p "$UNIT_DIR"
        cat > "$UNIT_DIR/a2a-bridge.service" <<SVCEOF
[Unit]
Description=Tide A2A Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$CONFIG_FILE
ExecStart=$BRIDGE_BIN start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVCEOF
        systemctl --user daemon-reload
        systemctl --user enable a2a-bridge
        info "Service registered: systemctl --user start a2a-bridge"
    fi
elif [ "$OS" = "darwin" ]; then
    read -r -p "  Register launchd service? [y/N] " REG_SVC
    if [[ "$REG_SVC" =~ ^[yY]$ ]]; then
        BRIDGE_BIN="$(command -v a2a-bridge || echo "$PYTHON -m a2a_bridge")"
        PLIST_DIR="$HOME/Library/LaunchAgents"
        mkdir -p "$PLIST_DIR"
        PLIST="$PLIST_DIR/com.tide.a2a-bridge.plist"
        cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.tide.a2a-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BRIDGE_BIN</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$CONFIG_DIR/bridge.log</string>
    <key>StandardErrorPath</key>
    <string>$CONFIG_DIR/bridge.log</string>
</dict>
</plist>
PLISTEOF
        launchctl load "$PLIST" 2>/dev/null || true
        info "Launchd service registered"
    fi
else
    warn "System service registration skipped (no systemd/launchd detected)"
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}━━━ Installation Complete ━━━${NC}"
echo ""
echo "  Quick start:"
echo "    a2a-bridge setup      # Interactive configuration"
echo "    a2a-bridge doctor      # Check environment"
echo "    a2a-bridge start       # Start in foreground"
echo "    a2a-bridge start -d    # Start as daemon"
echo ""
echo "  Config:  $CONFIG_FILE"
echo "  Docs:    https://github.com/multica-ai/tide/tree/main/a2a-bridge"
echo ""
