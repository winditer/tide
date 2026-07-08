#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");

const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
console.log(`${BOLD}  🚀 A2A Bridge - Post-install Setup${RESET}`);
console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

// Step 1: Check Python
function findPython() {
  const candidates = process.platform === "win32"
    ? ["python", "python3"]
    : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      const result = execSync(`${cmd} --version`, { stdio: "pipe", timeout: 5000 });
      const version = result.toString().trim();
      const match = version.match(/Python (\d+)\.(\d+)/);
      if (match && (parseInt(match[1]) > 3 || (parseInt(match[1]) === 3 && parseInt(match[2]) >= 11))) {
        return { cmd, version };
      }
    } catch {}
  }
  return null;
}

const pythonInfo = findPython();
if (pythonInfo) {
  console.log(`${GREEN}✓${RESET} Python found: ${pythonInfo.version} (${pythonInfo.cmd})`);
} else {
  console.log(`${YELLOW}⚠${RESET} Python 3.11+ not found. You'll need to install it before using a2a-bridge.`);
  console.log(`  → https://www.python.org/downloads/\n`);
  process.exit(0); // Don't fail npm install, just warn
}

// Step 2: Install Python package
try {
  execSync(`${pythonInfo.cmd} -c "import a2a_bridge"`, { stdio: "pipe", timeout: 10000 });
  console.log(`${GREEN}✓${RESET} Python package 'tide-a2a-bridge' already installed`);
} catch {
  console.log(`${YELLOW}→${RESET} Installing Python package 'tide-a2a-bridge'...`);
  try {
    const { resolve } = require("path");
    const fs = require("fs");
    const pyprojectPath = resolve(__dirname, "..", "pyproject.toml");
    if (fs.existsSync(pyprojectPath)) {
      execSync(`${pythonInfo.cmd} -m pip install -e "${resolve(__dirname, "..")}" --quiet`, {
        stdio: "inherit", timeout: 120000
      });
    } else {
      execSync(`${pythonInfo.cmd} -m pip install tide-a2a-bridge --quiet`, {
        stdio: "inherit", timeout: 120000
      });
    }
    console.log(`${GREEN}✓${RESET} Python package installed successfully`);
  } catch {
    console.log(`${YELLOW}⚠${RESET} Auto-install failed. Run manually: pip install tide-a2a-bridge`);
  }
}

// Step 3: Show next steps
console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
console.log(`${BOLD}  📋 Next Steps${RESET}`);
console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
console.log(`  ${GREEN}Tip:${RESET} You can also use npx without global install:`);
console.log(`     ${GREEN}$ npx @tide-ai/a2a-bridge start${RESET}\n`);
console.log(`  1. Run interactive setup:`);
console.log(`     ${GREEN}$ a2a-bridge setup${RESET}\n`);
console.log(`  2. Or start directly with defaults:`);
console.log(`     ${GREEN}$ a2a-bridge start${RESET}\n`);
console.log(`  3. Check environment health:`);
console.log(`     ${GREEN}$ a2a-bridge doctor${RESET}\n`);
console.log(`  For WebSocket push mode (NAT/firewall):`);
console.log(`     ${GREEN}$ a2a-bridge setup --daemon${RESET}\n`);
console.log(`  Full documentation:`);
console.log(`     https://github.com/anthropic-ai/tide/tree/main/a2a-bridge\n`);