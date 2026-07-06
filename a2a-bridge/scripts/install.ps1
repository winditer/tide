# ==========================================================================
# Tide A2A Bridge — installer for Windows
#
# Usage:
#   irm https://raw.githubusercontent.com/.../install.ps1 | iex
#
#   # Or from a local checkout:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#
# Environment variables (optional):
#   $env:BRIDGE_PORT         Port for the bridge server  (default: 8720)
#   $env:BRIDGE_API_KEY      API key for authentication
#   $env:SKIP_CLI_INSTALL    Set to "1" to skip npm CLI tools
# ==========================================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ── Helpers ──────────────────────────────────────────────────────────────
function Write-Ok   { param($msg) Write-Host "  " -NoNewline; Write-Host -ForegroundColor Green "✓" -NoNewline; Write-Host " $msg" }
function Write-Warn { param($msg) Write-Host "  " -NoNewline; Write-Host -ForegroundColor Yellow "!" -NoNewline; Write-Host " $msg" }
function Write-Fail { param($msg) Write-Host "  " -NoNewline; Write-Host -ForegroundColor Red "✗" -NoNewline; Write-Host " $msg" }
function Write-Header {
    param($msg)
    Write-Host ""
    Write-Host -ForegroundColor Cyan "  ━━━ $msg ━━━"
}

function Test-CommandExists {
    param($cmd)
    $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Install-ViaWinget {
    param($pkgId)
    if (Test-CommandExists winget) {
        Write-Warn "Installing $pkgId via winget..."
        winget install --accept-source-agreements --accept-package-agreements -e --id $pkgId --silent
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                     [System.Environment]::GetEnvironmentVariable("Path", "User")
        return $true
    }
    return $false
}

function Install-ViaChoco {
    param($pkg)
    if (Test-CommandExists choco) {
        Write-Warn "Installing $pkg via chocolatey..."
        choco install $pkg -y --no-progress
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                     [System.Environment]::GetEnvironmentVariable("Path", "User")
        return $true
    }
    return $false
}

# ── Banner ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host -ForegroundColor Cyan "  Tide A2A Bridge Installer"
Write-Host "  Platform: Windows ($env:PROCESSOR_ARCHITECTURE)"
Write-Host ""

# ── 1. Git ───────────────────────────────────────────────────────────────
Write-Header "Checking Git"

if (Test-CommandExists git) {
    $gitVer = (git --version) -replace "git version ", ""
    Write-Ok "Git $gitVer"
} else {
    $installed = Install-ViaWinget "Git.Git"
    if (-not $installed) {
        $installed = Install-ViaChoco "git"
    }
    if (-not $installed) {
        Write-Fail "Cannot auto-install Git. Please install from https://git-scm.com/"
        exit 1
    }
    Write-Ok "Git installed"
}

# ── 2. Python 3.11+ ─────────────────────────────────────────────────────
Write-Header "Checking Python"

$python = $null
foreach ($candidate in @("python", "python3", "py")) {
    if (Test-CommandExists $candidate) {
        try {
            $verOutput = & $candidate -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
            if ($LASTEXITCODE -eq 0) {
                $parts = $verOutput.Split(".")
                $major = [int]$parts[0]
                $minor = [int]$parts[1]
                if ($major -ge 3 -and $minor -ge 11) {
                    $python = $candidate
                    break
                }
            }
        } catch {}
    }
}

if ($null -eq $python) {
    Write-Warn "Python 3.11+ not found, installing..."
    $installed = Install-ViaWinget "Python.Python.3.12"
    if (-not $installed) {
        $installed = Install-ViaChoco "python312"
    }
    if (-not $installed) {
        Write-Fail "Cannot auto-install Python. Please install from https://python.org/"
        exit 1
    }
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                 [System.Environment]::GetEnvironmentVariable("Path", "User")
    $python = "python"
    Write-Ok "Python installed"
} else {
    $pyVer = & $python --version
    Write-Ok $pyVer
}

# Ensure pip
try {
    & $python -m pip --version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "pip missing" }
} catch {
    Write-Warn "pip not found, installing..."
    & $python -m ensurepip --upgrade 2>$null
    if ($LASTEXITCODE -ne 0) {
        Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile "$env:TEMP\get-pip.py"
        & $python "$env:TEMP\get-pip.py"
    }
    Write-Ok "pip installed"
}

# ── 3. Node.js 20+ ──────────────────────────────────────────────────────
Write-Header "Checking Node.js"

if (Test-CommandExists node) {
    $nodeVer = (node --version) -replace "v", ""
    $nodeMajor = [int]($nodeVer.Split(".")[0])
    if ($nodeMajor -ge 20) {
        Write-Ok "Node.js v$nodeVer"
    } else {
        Write-Warn "Node.js v$nodeVer < v20, upgrading..."
        $installed = Install-ViaWinget "OpenJS.NodeJS.LTS"
        if (-not $installed) { $installed = Install-ViaChoco "nodejs-lts" }
        if (-not $installed) {
            Write-Fail "Cannot auto-upgrade Node.js. Please install v20+ from https://nodejs.org/"
            exit 1
        }
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                     [System.Environment]::GetEnvironmentVariable("Path", "User")
        Write-Ok "Node.js upgraded"
    }
} else {
    Write-Warn "Node.js not found, installing..."
    $installed = Install-ViaWinget "OpenJS.NodeJS.LTS"
    if (-not $installed) { $installed = Install-ViaChoco "nodejs-lts" }
    if (-not $installed) {
        Write-Fail "Cannot auto-install Node.js. Please install from https://nodejs.org/"
        exit 1
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                 [System.Environment]::GetEnvironmentVariable("Path", "User")
    Write-Ok "Node.js installed"
}

# ── 4. Agent CLI tools ──────────────────────────────────────────────────
if ($env:SKIP_CLI_INSTALL -ne "1") {
    Write-Header "Checking Agent CLI tools"

    if (-not (Test-CommandExists npm)) {
        Write-Fail "npm not found. Please install Node.js properly."
        exit 1
    }

    function Install-NpmCli {
        param($name, $pkg)
        if (Test-CommandExists $name) {
            $path = (Get-Command $name).Source
            Write-Ok "$name already installed: $path"
        } else {
            Write-Warn "Installing $name..."
            & npm install -g --omit=optional --force $pkg 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "$name installation failed (will still continue)"
            } else {
                Write-Ok "$name installed"
            }
        }
    }

    Install-NpmCli "codex"  "@openai/codex"
    Install-NpmCli "claude" "@anthropic-ai/claude-code"
    Install-NpmCli "qoder"  "@qoder-ai/qodercli"
}

# ── 5. Install A2A Bridge ───────────────────────────────────────────────
Write-Header "Installing A2A Bridge"

# Check if running from local source
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { "." }
$projectDir = Split-Path $scriptDir -Parent
$pyprojectPath = Join-Path $projectDir "pyproject.toml"

if (Test-Path $pyprojectPath) {
    Write-Ok "Installing from local source: $projectDir"
    & $python -m pip install --quiet -e $projectDir
} else {
    Write-Ok "Installing from PyPI..."
    & $python -m pip install --quiet tide-a2a-bridge
}

if (Test-CommandExists a2a-bridge) {
    Write-Ok "a2a-bridge installed: $((Get-Command a2a-bridge).Source)"
} else {
    # Check user scripts directory
    $userScripts = Join-Path $env:APPDATA "Python\Python312\Scripts"
    if (Test-Path (Join-Path $userScripts "a2a-bridge.exe")) {
        $env:Path += ";$userScripts"
        Write-Warn "Added $userScripts to PATH"
    } elseif (Test-CommandExists "a2a-bridge") {
        Write-Ok "a2a-bridge installed"
    } else {
        Write-Warn "a2a-bridge not found in PATH. Try: $python -m a2a_bridge --version"
    }
}

# ── 6. Default config ───────────────────────────────────────────────────
Write-Header "Configuration"

$configDir = Join-Path $env:USERPROFILE ".a2a-bridge"
$configFile = Join-Path $configDir ".env"

if (Test-Path $configFile) {
    Write-Ok "Config already exists: $configFile"
} else {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    $configContent = @"
# A2A Bridge Configuration — generated by installer
# Edit as needed, then run: a2a-bridge start

BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=8720
BRIDGE_PUBLIC_URL=
BRIDGE_API_KEY=
BRIDGE_WORK_DIR=$env:USERPROFILE\workspace
BRIDGE_MAX_CONCURRENCY=5
BRIDGE_DEFAULT_TIMEOUT=600
BRIDGE_DEFAULT_AGENT=codex
BRIDGE_LOG_LEVEL=INFO

# LLM API Keys (uncomment and fill in)
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=

# Git Integration (optional)
GIT_REPOS_DIR=$env:TEMP\a2a-repos
GIT_DEFAULT_BRANCH=main
GIT_AUTO_PUSH=true
# GIT_DEFAULT_REPO=
# GIT_AUTH_TOKEN=
# GIT_SSH_KEY_PATH=
"@
    Set-Content -Path $configFile -Value $configContent -Encoding UTF8
    Write-Ok "Default config written to $configFile"
}

# ── 7. Scheduled task (optional) ────────────────────────────────────────
Write-Header "Auto-start Service"

$taskName = "TideA2ABridge"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Ok "Scheduled task already registered: $taskName"
} else {
    $answer = Read-Host "  Register as auto-start task? [y/N]"
    if ($answer -match "^[yY]") {
        $bridgeCmd = if (Test-CommandExists a2a-bridge) {
            (Get-Command a2a-bridge).Source
        } else {
            "$python"
        }
        $bridgeArgs = if ($bridgeCmd -eq "$python") { "-m a2a_bridge start" } else { "start" }

        $action = New-ScheduledTaskAction -Execute $bridgeCmd -Argument $bridgeArgs
        $trigger = New-ScheduledTaskTrigger -AtLogon
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

        Register-ScheduledTask `
            -TaskName $taskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Principal $principal `
            -Description "Tide A2A Bridge background service" `
            | Out-Null

        Write-Ok "Scheduled task registered: $taskName"
        Write-Ok "Start manually: Start-ScheduledTask -TaskName '$taskName'"
    }
}

# ── Done ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host -ForegroundColor Green "  ━━━ Installation Complete ━━━"
Write-Host ""
Write-Host "  Quick start:"
Write-Host "    a2a-bridge setup      # Interactive configuration"
Write-Host "    a2a-bridge doctor      # Check environment"
Write-Host "    a2a-bridge start       # Start in foreground"
Write-Host "    a2a-bridge start -d    # Start as daemon"
Write-Host ""
Write-Host "  Config:  $configFile"
Write-Host ""
