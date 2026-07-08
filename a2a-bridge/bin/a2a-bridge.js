#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const { resolve } = require("path");

// Find Python executable
function findPython() {
  const candidates = process.platform === "win32"
    ? ["python", "python3", "py -3"]
    : ["python3", "python"];

  for (const cmd of candidates) {
    try {
      const result = require("child_process").execSync(
        `${cmd} --version`, { stdio: "pipe", timeout: 5000 }
      );
      const version = result.toString().trim();
      const match = version.match(/Python (\d+)\.(\d+)/);
      if (match && (parseInt(match[1]) > 3 || (parseInt(match[1]) === 3 && parseInt(match[2]) >= 11))) {
        return cmd.split(" ")[0]; // handle "py -3" → "py"
      }
    } catch {}
  }
  return null;
}

const python = findPython();

if (!python) {
  console.error("\x1b[31m✗ Python 3.11+ is required but not found.\x1b[0m");
  console.error("  Install Python: https://www.python.org/downloads/");
  console.error("  Or use pyenv:   pyenv install 3.11");
  process.exit(1);
}

// Check if the Python package is installed
try {
  require("child_process").execSync(
    `${python} -c "import a2a_bridge"`, { stdio: "pipe", timeout: 10000 }
  );
} catch {
  console.error("\x1b[33m⚠ Python package 'tide-a2a-bridge' not found. Installing...\x1b[0m");
  try {
    // Try installing from local source first (development mode)
    const pyprojectPath = resolve(__dirname, "..", "pyproject.toml");
    const fs = require("fs");
    if (fs.existsSync(pyprojectPath)) {
      require("child_process").execSync(
        `${python} -m pip install -e "${resolve(__dirname, "..")}"`,
        { stdio: "inherit", timeout: 120000 }
      );
    } else {
      // Fall back to PyPI
      require("child_process").execSync(
        `${python} -m pip install tide-a2a-bridge`,
        { stdio: "inherit", timeout: 120000 }
      );
    }
  } catch (e) {
    console.error("\x1b[31m✗ Failed to install Python package.\x1b[0m");
    console.error("  Try manually: pip install tide-a2a-bridge");
    process.exit(1);
  }
}

// Proxy all arguments to the Python CLI
const args = ["-m", "a2a_bridge", ...process.argv.slice(2)];
const child = spawn(python, args, {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd()
});

child.on("error", (err) => {
  console.error(`\x1b[31m✗ Failed to start: ${err.message}\x1b[0m`);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code || 0);
});