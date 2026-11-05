#!/usr/bin/env node
// UCL Moodle MCP setup: gets your UCL Moodle token from your logged-in browser and deploys your
// own personal MCP server on Cloudflare Workers.
//   npm create ucl-moodle-mcp      (downloads this repo and runs this script)
//   npm run setup                  (from a clone of the repo)
//
// Zero dependencies on purpose (only Node built-ins), so it runs before `npm install`.

import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const MOODLE = "https://moodle.ucl.ac.uk"; // this fork is UCL-only (see src/config.ts)
const WORKER_NAME = "moodle-mcp";
const WAIT_SECONDS = 120;
const CLAUDE_HELP = "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp";
const CHATGPT_HELP = "https://developers.openai.com/plugins/deploy/connect-chatgpt";
const RERUN = "npm create ucl-moodle-mcp";
const CF_SIGNUP = "https://dash.cloudflare.com/sign-up/workers-and-pages";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORM = process.platform; // win32 | darwin | linux
const isWin = PLATFORM === "win32";

// ---------------------------------------------------------------- output

const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const cyan = paint(36), green = paint(32), red = paint(31), yellow = paint(33), bold = paint(1), dim = paint(2);

const step = (n, t) => console.log(`\n${cyan(`[${n}/3] ${t}`)}`);
const ok = (t) => console.log(`  ${green("[ok]")} ${t}`);
const info = (t) => console.log(`  ${t}`);
const warn = (t) => console.log(`  ${yellow("[!]")} ${t}`);

class SetupError extends Error {}
const fail = (msg) => { throw new SetupError(msg); };

// ---------------------------------------------------------------- prompts
// A fresh readline per question, so stdin is free again when wrangler needs it.

async function ask(question, def) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`  ${question}${def ? ` [${def}]` : ""} `)).trim();
    return a || def || "";
  } finally { rl.close(); }
}

// ---------------------------------------------------------------- processes

function openUrl(url) {
  if (isWin) execFileSync("rundll32", ["url.dll,FileProtocolHandler", url]);
  else if (PLATFORM === "darwin") execFileSync("open", [url]);
  else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

/** Runs npm/npx in the repo. echo: show output live; capture: also return it; input: written to stdin. */
function run(cmd, args, { input, capture = false, echo = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      shell: isWin, // npm/npx are .cmd files on Windows; args here are fixed strings, never user input
      stdio: [input !== undefined ? "pipe" : "inherit", capture ? "pipe" : echo ? "inherit" : "ignore", echo ? "inherit" : "pipe"],
    });
    let out = "";
    if (capture) child.stdout.on("data", (d) => { out += d; if (echo) process.stdout.write(d); });
    if (!echo && child.stderr) child.stderr.on("data", (d) => { out += d; });
    if (input !== undefined) child.stdin.end(input);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

// ---------------------------------------------------------------- moodle

export async function checkToken(base, token) {
  let r;
  try {
    const res = await fetch(`${base}/webservice/rest/server.php`, {
      method: "POST",
      body: new URLSearchParams({ wstoken: token, wsfunction: "core_webservice_get_site_info", moodlewsrestformat: "json" }),
      signal: AbortSignal.timeout(30_000),
    });
    r = await res.json();
  } catch (e) {
    fail(`Could not check the token with ${base}: ${e.message}`);
  }
  if (r.errorcode) fail(`Moodle rejected the token (${r.errorcode}): ${r.message}`);
  if (!r.userid) fail("Unexpected answer from Moodle while checking the token.");
  return r;
}

/** moodlemobile://token=BASE64(signature:::TOKEN[:::privatetoken]) -> TOKEN */
export function tokenFromCallback(raw) {
  const m = /token=([A-Za-z0-9+/=%_-]+)/.exec(raw);
  if (!m) fail(`Moodle answered with an unexpected link: ${raw}`);
  let b64 = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 && b64.endsWith("/")) b64 = b64.slice(0, -1); // some browsers append a slash
  const parts = Buffer.from(b64, "base64").toString("utf8").split(":::");
  if (parts.length < 2 || !/^[0-9a-f]{32}$/i.test(parts[1])) fail("The token sent by Moodle does not have the expected format.");
  return parts[1];
}

// ---------------------------------------------------------------- method B: temporary moodlemobile:// handler
// Each install* returns a synchronous cleanup function that puts things back as they were.

export function installHandlerWindows(work, callbackFile) {
  const key = "HKCU\\Software\\Classes\\moodlemobile";
  const backup = path.join(work, "previous-handler.reg");
  const handler = path.join(work, "handler.ps1");
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  fs.writeFileSync(handler, `param([string]$u)\r\nSet-Content -LiteralPath '${callbackFile}' -Value $u -Encoding ASCII\r\n`);

  const reg = (...a) => execFileSync("reg", a, { stdio: "ignore" });
  let hadKey = true;
  try { reg("query", key); } catch { hadKey = false; }
  if (hadKey) { reg("export", key, backup, "/y"); reg("delete", key, "/f"); } // e.g. the Moodle desktop app

  reg("add", key, "/ve", "/d", "URL:moodlemobile", "/f");
  reg("add", key, "/v", "URL Protocol", "/d", "", "/f");
  reg("add", `${key}\\shell\\open\\command`, "/ve", "/f", "/d",
    `"${ps}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${handler}" "%1"`);

  return () => {
    try { reg("delete", key, "/f"); } catch {}
    if (hadKey) { try { reg("import", backup); } catch {} }
  };
}

export function installHandlerMac(work, callbackFile) {
  const app = path.join(work, "MoodleMcpTokenCatcher.app");
  const bundleId = "com.moodle-mcp.token-catcher";
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  execFileSync("osacompile", ["-o", app,
    "-e", "on open location theURL",
    "-e", `  do shell script "printf %s " & quoted form of theURL & " > " & quoted form of "${callbackFile}"`,
    "-e", "end open location"], { stdio: "ignore" });
  const plist = path.join(app, "Contents", "Info.plist");
  try { execFileSync("/usr/libexec/PlistBuddy", ["-c", "Delete :CFBundleIdentifier", plist], { stdio: "ignore" }); } catch {}
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c", `Add :CFBundleIdentifier string ${bundleId}`,
    "-c", "Add :LSUIElement bool true",
    "-c", "Add :CFBundleURLTypes array",
    "-c", "Add :CFBundleURLTypes:0 dict",
    "-c", "Add :CFBundleURLTypes:0:CFBundleURLName string moodlemobile",
    "-c", "Add :CFBundleURLTypes:0:CFBundleURLSchemes array",
    "-c", "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string moodlemobile",
    plist], { stdio: "ignore" });
  try { execFileSync("codesign", ["--force", "--deep", "-s", "-", app], { stdio: "ignore" }); } catch {}
  execFileSync(lsregister, ["-f", app]);
  // Win over the Moodle app if it is installed; once our app is unregistered, macOS falls back to it.
  try {
    execFileSync("osascript", ["-l", "JavaScript",
      "-e", 'ObjC.import("CoreServices")',
      "-e", `$.LSSetDefaultHandlerForURLScheme($("moodlemobile"), $("${bundleId}"))`], { stdio: "ignore" });
  } catch {}
  return () => { try { execFileSync(lsregister, ["-u", app], { stdio: "ignore" }); } catch {} };
}

export function installHandlerLinux(work, callbackFile) {
  try { execFileSync("xdg-mime", ["--version"], { stdio: "ignore" }); }
  catch { fail("xdg-utils (xdg-mime / xdg-open) is required for method B. Install it, or run again and pick method A."); }
  const appsDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "applications");
  const desktop = "moodle-mcp-token-catcher.desktop";
  const handler = path.join(work, "handler.sh");
  fs.mkdirSync(appsDir, { recursive: true });
  fs.writeFileSync(handler, `#!/bin/sh\nprintf '%s' "$1" > "${callbackFile}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(appsDir, desktop),
    `[Desktop Entry]\nType=Application\nName=moodle-mcp token catcher\nExec="${handler}" %u\n` +
    `MimeType=x-scheme-handler/moodlemobile;\nNoDisplay=true\nTerminal=false\n`);
  let prev = "";
  try { prev = execFileSync("xdg-mime", ["query", "default", "x-scheme-handler/moodlemobile"]).toString().trim(); } catch {}
  execFileSync("xdg-mime", ["default", desktop, "x-scheme-handler/moodlemobile"]);
  const refresh = () => { try { execFileSync("update-desktop-database", [appsDir], { stdio: "ignore" }); } catch {} };
  refresh();
  return () => {
    fs.rmSync(path.join(appsDir, desktop), { force: true });
    if (prev && prev !== desktop) {
      try { execFileSync("xdg-mime", ["default", prev, "x-scheme-handler/moodlemobile"]); } catch {}
    } else {
      const f = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "mimeapps.list");
      try { fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.includes(desktop)).join("\n")); } catch {}
    }
    refresh();
  };
}

async function tokenViaBrowser(base) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "moodle-mcp-"));
  const callbackFile = path.join(work, "callback.txt");
  let restore = () => {};
  const onSignal = () => { restore(); fs.rmSync(work, { recursive: true, force: true }); process.exit(130); };
  process.once("SIGINT", onSignal);

  let callback = "";
  try {
    restore = isWin ? installHandlerWindows(work, callbackFile)
      : PLATFORM === "darwin" ? installHandlerMac(work, callbackFile)
      : installHandlerLinux(work, callbackFile);

    const passport = randomInt(100000, 999999999);
    info("Opening Moodle in your default browser...");
    info('If the browser asks whether to open a "moodlemobile" link / app, click Open / Allow.');
    openUrl(`${base}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=moodlemobile`);

    process.stdout.write(`  Waiting up to ${WAIT_SECONDS}s for Moodle `);
    for (let i = 0; i < WAIT_SECONDS * 2 && !callback; i++) {
      if (i % 10 === 0) process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 500));
      try { callback = fs.readFileSync(callbackFile, "utf8").trim(); } catch {}
    }
    process.stdout.write("\n");
  } finally {
    restore();
    process.removeListener("SIGINT", onSignal);
    fs.rmSync(work, { recursive: true, force: true });
  }

  if (!callback) {
    fail(`No token came back from ${base}.
  You are most likely NOT logged in to UCL Moodle in your default browser.
  -> Open ${base} in your default browser, log in with your UCL account,
     then run "${RERUN}" again.`);
  }
  return tokenFromCallback(callback);
}

// ---------------------------------------------------------------- cloudflare

async function mcpAnswers(url) {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "moodle-mcp-setup", version: "1" } },
  });
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(url, {
        method: "POST", body,
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok && (await res.text()).includes("moodle-mcp")) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 5000)); // new workers.dev hostnames can take a few seconds
  }
  return false;
}

// ---------------------------------------------------------------- main

async function main() {
  console.log(`\n  ${bold("UCL Moodle MCP setup")}`);
  console.log(`  ${dim("Gives Claude / ChatGPT read access to your UCL Moodle through your own Cloudflare Worker.")}`);

  if (!fs.existsSync(path.join(ROOT, "wrangler.toml")) || !fs.existsSync(path.join(ROOT, "src", "worker.ts"))) {
    fail(`Run this from the moodle-mcp repository (expected wrangler.toml in ${ROOT}), or use "${RERUN}".`);
  }

  // 1. credentials: the Moodle mobile-app launch link is the only method that works with UCL's SSO
  step(1, "Getting your UCL Moodle token");
  info("You need to be logged in to UCL Moodle in your default browser.");
  const base = MOODLE;
  const token = await tokenViaBrowser(base);
  const site = await checkToken(base, token);
  ok(`Logged in as ${site.fullname} on ${site.sitename}`);

  // 2. cloudflare worker
  step(2, "Deploying your Cloudflare Worker");
  info("Installing dependencies (npm install)...");
  if ((await run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"])).code !== 0) {
    fail("npm install failed (see the output above).");
  }

  const who = await run("npx", ["wrangler", "whoami"], { capture: true, echo: false });
  if (/not authenticated/i.test(who.out)) {
    info(`Log in to Cloudflare in the browser window that opens (free account: ${CF_SIGNUP}).`);
    if ((await run("npx", ["wrangler", "login"])).code !== 0) fail("Cloudflare login failed.");
  } else {
    ok("Already logged in to Cloudflare.");
  }

  info("Deploying...");
  const deploy = await run("npx", ["wrangler", "deploy"], { capture: true });
  if (deploy.code !== 0) {
    fail("wrangler deploy failed (see above). If it mentions a workers.dev subdomain, open " +
      "https://dash.cloudflare.com -> Workers & Pages once to create it, then run this again.");
  }
  let workerUrl = /https:\/\/[A-Za-z0-9.-]+\.workers\.dev/.exec(deploy.out)?.[0];
  if (!workerUrl) {
    warn("Could not read the Worker URL from the deploy output.");
    workerUrl = (await ask("Paste your Worker URL (https://moodle-mcp.<you>.workers.dev):")).replace(/\/+$/, "");
  }

  info("Storing your Moodle token as an encrypted Worker secret...");
  const secret = randomBytes(32).toString("hex");
  const secrets = JSON.stringify({ MOODLE_URL: base, MOODLE_TOKEN: token, MCP_AUTH_SECRET: secret });
  if ((await run("npx", ["wrangler", "secret", "bulk", "--name", WORKER_NAME], { input: secrets })).code !== 0) {
    fail("Could not store the secrets on Cloudflare (see above).");
  }

  const mcpUrl = `${workerUrl}/${secret}/mcp`;
  info("Checking that your server answers...");
  if (await mcpAnswers(mcpUrl)) ok("Your MCP server is up.");
  else warn("The server did not answer yet. Give it a minute; new workers.dev URLs can be slow to appear.");

  // 3. done
  step(3, "Done!");
  console.log(`
  ${bold("Your MCP server URL:")}

    ${green(mcpUrl)}

  ${red(`!! This URL is PERSONAL. Do not share it with anyone. !!
  It is linked to your own Moodle account (${site.fullname}): anyone who has it can read
  your courses, files, grades and messages as you. If it leaks, run "${RERUN}" again
  to get a new URL (the old one stops working).`)}

  ${bold("Connect it to your AI assistant:")}
   - Claude: Settings > Connectors > Add custom connector, paste the URL.
     Guide: ${CLAUDE_HELP}
   - ChatGPT: add a custom MCP server and paste the URL (authentication: none).
     Guide: ${CHATGPT_HELP}
   - Claude Code:
     claude mcp add moodle --transport http ${mcpUrl}

  ${dim('Moodle tokens can expire. If the tools start saying "Invalid Moodle token", just run "${RERUN}" again.')}
`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    console.error(`moodle-mcp needs Node.js 18 or newer (you have ${process.version}). Update it from https://nodejs.org`);
    process.exit(1);
  }
  main().catch((e) => {
    console.error(`\n${red("ERROR:")} ${e instanceof SetupError ? e.message : e?.stack || e}\n`);
    process.exit(1);
  });
}
