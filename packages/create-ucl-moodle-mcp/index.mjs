#!/usr/bin/env node
// npm create ucl-moodle-mcp
//
// Tiny launcher, no dependencies: downloads the latest dussud/moodle-mcp source into
// ~/.ucl-moodle-mcp/app and runs its setup script (scripts/setup.mjs), which gets your
// UCL Moodle token from your browser and deploys your personal Cloudflare Worker.
// Keeping the real logic in the repo means fixes ship without republishing this package.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SOURCE = process.env.UCL_MOODLE_MCP_SOURCE || "https://codeload.github.com/dussud/moodle-mcp/tar.gz/refs/heads/master";

const major = Number(process.versions.node.split(".")[0]);
if (major < 18) {
  console.error(`UCL Moodle MCP needs Node.js 18 or newer (you have ${process.version}). Update it from https://nodejs.org`);
  process.exit(1);
}

const home = path.join(os.homedir(), ".ucl-moodle-mcp");
const app = path.join(home, "app");
const staging = path.join(home, "app.new");
const archive = path.join(home, "source.tar.gz");

async function download() {
  console.log(`\n  Downloading the latest UCL Moodle MCP into ${app} ...`);
  fs.mkdirSync(home, { recursive: true });
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${SOURCE}`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging);
  // `tar` ships with macOS, Linux and Windows 10+. On Windows use the built-in one explicitly:
  // a GNU tar from Git for Windows on the PATH would read "C:\..." as a remote host.
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-xzf", archive, "-C", staging, "--strip-components=1"], { stdio: "inherit" });
  fs.rmSync(archive, { force: true });
  if (!fs.existsSync(path.join(staging, "scripts", "setup.mjs"))) throw new Error("the download does not contain scripts/setup.mjs");

  // Keep the previous node_modules so re-runs don't reinstall everything from scratch.
  const oldModules = path.join(app, "node_modules");
  if (fs.existsSync(oldModules)) fs.renameSync(oldModules, path.join(staging, "node_modules"));
  fs.rmSync(app, { recursive: true, force: true });
  fs.renameSync(staging, app);
}

try {
  await download();
} catch (e) {
  console.error(`\nERROR: could not download UCL Moodle MCP: ${e.message}\n`);
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(app, "scripts", "setup.mjs")], { cwd: app, stdio: "inherit" });
child.on("close", (code) => process.exit(code ?? 1));
