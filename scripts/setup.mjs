#!/usr/bin/env node
// UCL Moodle MCP setup: gets your UCL Moodle token (with a temporary helper, or copied by hand from
// the browser's developer tools), then deploys your own personal MCP server on Cloudflare Workers.
//   npm create ucl-moodle-mcp      (downloads this repo and runs this script)
//   npm run setup                  (from a clone of the repo)
//
// Zero dependencies on purpose (only Node built-ins), so it runs before `npm install`.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const MOODLE = "https://moodle.ucl.ac.uk"; // this fork is UCL-only (see src/config.ts)
const WORKER_NAME = "moodle-mcp";
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
// One shared prompter while we're asking questions; releaseInput() closes it so stdin is free
// again when wrangler needs the terminal (Cloudflare login and deploy prompts).

let sharedInput = null;
const ask = (question, options) => (sharedInput ??= prompter()).ask(question, options);
function releaseInput() { sharedInput?.close(); sharedInput = null; }

function prompter() {
  const interactive = !!process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
  let muted = false;
  // In hidden mode, don't echo what's typed: it's a credential and would stay in the scrollback.
  rl._writeToOutput = (s) => { if (!muted) process.stdout.write(s); else if (s.includes("\n")) process.stdout.write("\n"); };
  // Queue lines ourselves: rl.question() drops lines that arrive before it is called (piped input).
  const lines = [];
  let waiting = null, ended = false;
  rl.on("line", (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
  rl.once("close", () => { ended = true; if (waiting) { const w = waiting; waiting = null; w(null); } });
  return {
    async ask(question, { hidden = false } = {}) {
      if (ended) process.stdout.write(`  ${question} `); // piped input already fully read
      else { rl.setPrompt(`  ${question} `); rl.prompt(); }
      muted = hidden;
      const result = lines.length ? lines.shift() : ended ? null : await new Promise((r) => { waiting = r; });
      muted = false;
      if (!interactive) process.stdout.write("\n");
      if (result === null) fail("No input received."); // stdin ended (e.g. Ctrl+D)
      return result.trim();
    },
    close: () => { if (!ended) rl.close(); },
  };
}

// ---------------------------------------------------------------- processes

/** Puts text on the clipboard. Returns false when no clipboard tool is available. */
function copyToClipboard(text) {
  const tools = isWin ? [["clip", []]]
    : PLATFORM === "darwin" ? [["pbcopy", []]]
    : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  for (const [cmd, args] of tools) {
    try {
      if (spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 5000 }).status === 0) return true;
    } catch {}
  }
  return false;
}

/** Runs npm/npx in the repo. echo: show output live; capture: also return it; input: written to stdin. */
function run(cmd, args, { input, capture = false, echo = true } = {}) {
  return new Promise((resolve, reject) => {
    // npm/npx are .cmd files on Windows, which Node can only start through cmd.exe. Passing a
    // single command string (args are fixed strings here, never user input) avoids Node's
    // DEP0190 warning that `shell: true` with an args array triggers.
    const [file, argv] = isWin ? ["cmd.exe", ["/d", "/s", "/c", [cmd, ...args].join(" ")]] : [cmd, args];
    const child = spawn(file, argv, {
      cwd: ROOT,
      stdio: [input !== undefined ? "pipe" : "inherit", capture ? "pipe" : echo ? "inherit" : "ignore", capture || !echo ? "pipe" : "inherit"],
    });
    let out = "";
    if (capture) child.stdout.on("data", (d) => { out += d; if (echo) process.stdout.write(d); });
    if (child.stderr) child.stderr.on("data", (d) => { out += d; if (echo) process.stderr.write(d); });
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

/**
 * Finds the Moodle token in whatever the user pasted: the whole moodlemobile://token=... link,
 * Chrome's console error that contains it, just the base64 part, or the bare 32-character token.
 * The link carries BASE64(signature:::TOKEN[:::privatetoken]); only TOKEN is needed.
 * Returns null when nothing usable is found.
 */
export function tokenFromPaste(raw) {
  const text = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^[0-9a-f]{32}$/i.test(text)) return text.toLowerCase();

  const link = /moodlemobile:\/\/token=([A-Za-z0-9+/=%_-]+)/i.exec(text);
  let b64 = link ? link[1] : /^[A-Za-z0-9+/=%_-]{40,}$/.test(text) ? text : null;
  if (!b64) return null;
  try { b64 = decodeURIComponent(b64); } catch {}
  b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 && b64.endsWith("/")) b64 = b64.slice(0, -1); // some browsers append a slash
  const parts = Buffer.from(b64, "base64").toString("utf8").split(":::");
  return parts.length >= 2 && /^[0-9a-f]{32}$/i.test(parts[1]) ? parts[1].toLowerCase() : null;
}

// ---------------------------------------------------------------- token
// UCL Moodle uses single sign-on, so the only token it hands out is the official mobile app's.
// Moodle gives it to the app by redirecting a logged-in browser to moodlemobile://token=...
// Two ways to catch that link:
//   1. (default) a small temporary helper registered for moodlemobile:// links: an AppleScript app
//      on macOS, a PowerShell script on Windows, a .desktop launcher on Linux
//   2. the user copies it from the browser's developer tools and pastes it

const HELPER_NAME = "UCL Moodle MCP";
const HELPER_WAIT_SECONDS = 180;
const SUBDOMAIN_WAIT_SECONDS = 120;

function launchLink(base) {
  const passport = randomInt(100000, 999999999);
  return `${base}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=moodlemobile`;
}

function openUrl(url) {
  if (PLATFORM === "darwin") execFileSync("open", [url]);
  // url.dll is what Windows itself uses to open links; no cmd.exe, so the & in the URL is safe.
  else if (isWin) execFileSync("rundll32", ["url.dll,FileProtocolHandler", url]);
  else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

function hasCommand(cmd, args = ["--version"]) {
  try { execFileSync(cmd, args, { stdio: "ignore" }); return true; } catch { return false; }
}

async function getToken(base) {
  console.log(`
  UCL Moodle uses single sign-on, so the only token it gives out is the one for the official
  Moodle mobile app. To get it, you open a special Moodle link while logged in. Moodle then sends
  your browser to a ${bold("moodlemobile://token=...")} link, the link that normally opens the Moodle app.
  The setup needs that link, so it can read your token from it.`);

  if (PLATFORM === "linux" && !hasCommand("xdg-mime")) {
    warn("xdg-utils isn't installed, so the automatic method can't work here. Using the manual one.");
    return tokenManually(base);
  }

  console.log(`
  How do you want to get it?
    ${bold("1)")} Automatic ${dim("(recommended)")}: a small temporary helper catches the link for you.
    ${bold("2)")} Manual: you copy the link from your browser's developer tools and paste it here.`);
  const choice = await ask("Choice [1]:");
  if (choice === "2") return tokenManually(base);

  for (;;) {
    const result = await tokenViaHelper(base);
    if (result) return result;
    warn("The link didn't arrive. Either you weren't logged in to Moodle yet, or the browser's");
    info('"Open ...?" prompt wasn\'t accepted.');
    const next = (await ask("Press Enter to try again, or type M to copy the link by hand:")).toUpperCase();
    if (next === "M") return tokenManually(base);
  }
}

// ---------------------------------------------------------------- token, option 1: temporary helper

/**
 * macOS: builds and registers a tiny AppleScript app that handles moodlemobile:// links by writing
 * the link to `callbackFile`. Returns a synchronous cleanup function that unregisters and deletes it.
 */
export function installHandlerMac(callbackFile) {
  // LaunchServices silently refuses to register apps that live in a temporary folder
  // (os.tmpdir() is /var/folders/.../T/ on macOS), so build the app in Application Support.
  const appDir = path.join(os.homedir(), "Library", "Application Support", "ucl-moodle-mcp");
  // Browsers show the app's file name in their "Open ...?" prompt, not CFBundleName.
  const app = path.join(appDir, `${HELPER_NAME}.app`);
  const bundleId = "com.moodle-mcp.token-catcher";
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  fs.rmSync(app, { recursive: true, force: true }); // leftover from an interrupted run
  fs.mkdirSync(appDir, { recursive: true });
  execFileSync("osacompile", ["-o", app,
    "-e", "on open location theURL",
    "-e", `  do shell script "printf %s " & quoted form of theURL & " > " & quoted form of "${callbackFile}"`,
    "-e", "end open location"], { stdio: "ignore" });
  const plist = path.join(app, "Contents", "Info.plist");
  try { execFileSync("/usr/libexec/PlistBuddy", ["-c", "Delete :CFBundleIdentifier", plist], { stdio: "ignore" }); } catch {}
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c", `Add :CFBundleIdentifier string ${bundleId}`,
    "-c", "Add :LSUIElement bool true",
    "-c", `Set :CFBundleName ${HELPER_NAME}`,
    "-c", `Add :CFBundleDisplayName string ${HELPER_NAME}`,
    "-c", "Add :CFBundleURLTypes array",
    "-c", "Add :CFBundleURLTypes:0 dict",
    "-c", "Add :CFBundleURLTypes:0:CFBundleURLName string moodlemobile",
    "-c", "Add :CFBundleURLTypes:0:CFBundleURLSchemes array",
    "-c", "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string moodlemobile",
    plist], { stdio: "ignore" });
  // Editing Info.plist breaks the applet's signature; Apple Silicon won't run unsigned code, so re-sign
  // it locally. Gatekeeper doesn't check it: only downloaded (quarantined) apps are checked.
  try { execFileSync("codesign", ["--force", "--deep", "-s", "-", app], { stdio: "ignore" }); } catch {}
  execFileSync(lsregister, ["-f", app]);
  // Win over the Moodle app if it is installed; once our app is unregistered, macOS falls back to it.
  try {
    execFileSync("osascript", ["-l", "JavaScript",
      "-e", 'ObjC.import("CoreServices")',
      "-e", `$.LSSetDefaultHandlerForURLScheme($("moodlemobile"), $("${bundleId}"))`], { stdio: "ignore" });
  } catch {}
  return () => {
    try { execFileSync(lsregister, ["-u", app], { stdio: "ignore" }); } catch {}
    fs.rmSync(appDir, { recursive: true, force: true });
  };
}

/**
 * Windows: registers moodlemobile:// for the current user (HKCU, no admin) to run a two-line
 * PowerShell script that writes the link to `callbackFile`. Any previous handler (the Moodle desktop
 * app, say) is exported first and restored by the returned cleanup function.
 */
export function installHandlerWindows(work, callbackFile) {
  const key = "HKCU\\Software\\Classes\\moodlemobile";
  const backup = path.join(work, "previous-handler.reg");
  const handler = path.join(work, "handler.ps1");
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  fs.writeFileSync(handler,
    `param([string]$u)\r\nSet-Content -LiteralPath '${callbackFile.replace(/'/g, "''")}' -Value $u -Encoding ASCII\r\n`);

  const reg = (...a) => execFileSync("reg", a, { stdio: "ignore" });
  let hadKey = true;
  try { reg("query", key); } catch { hadKey = false; }
  if (hadKey) { reg("export", key, backup, "/y"); reg("delete", key, "/f"); }

  reg("add", key, "/ve", "/d", "URL:moodlemobile", "/f");
  reg("add", key, "/v", "URL Protocol", "/d", "", "/f");
  // Without this, browsers would ask whether to open "Windows PowerShell".
  reg("add", `${key}\\shell\\open`, "/v", "FriendlyAppName", "/d", HELPER_NAME, "/f");
  reg("add", `${key}\\shell\\open\\command`, "/ve", "/f", "/d",
    `"${ps}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${handler}" "%1"`);

  return () => {
    try { reg("delete", key, "/f"); } catch {}
    if (hadKey) { try { reg("import", backup); } catch {} }
  };
}

/**
 * Linux: adds a hidden .desktop launcher for x-scheme-handler/moodlemobile that runs a two-line shell
 * script writing the link to `callbackFile`. The cleanup function removes it and restores the
 * previous default handler, if there was one.
 */
export function installHandlerLinux(work, callbackFile) {
  const appsDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "applications");
  const desktop = "ucl-moodle-mcp-token-catcher.desktop";
  const handler = path.join(work, "handler.sh");
  fs.mkdirSync(appsDir, { recursive: true });
  fs.writeFileSync(handler, `#!/bin/sh\nprintf '%s' "$1" > '${callbackFile.replace(/'/g, "'\\''")}'\n`, { mode: 0o755 });
  // xdg-open's fallback mode (outside GNOME/KDE) doesn't understand quotes in Exec, so only quote if needed.
  const exec = /^[\w/.-]+$/.test(handler) ? handler : `"${handler}"`;
  fs.writeFileSync(path.join(appsDir, desktop),
    `[Desktop Entry]\nType=Application\nName=${HELPER_NAME}\nExec=${exec} %u\n` +
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

function installHelper(work, callbackFile) {
  return PLATFORM === "darwin" ? installHandlerMac(callbackFile)
    : isWin ? installHandlerWindows(work, callbackFile)
    : installHandlerLinux(work, callbackFile);
}

function helperDescription() {
  if (PLATFORM === "darwin") {
    return `  - The setup creates a small helper app called ${bold(`"${HELPER_NAME}"`)} and registers it for
    moodlemobile:// links. All it does is save the link to a file for the setup to read.
    It's built on your Mac from scripts/setup.mjs (nothing is downloaded) and deleted as soon as
    the link arrives.`;
  }
  if (isWin) {
    return `  - The setup registers a helper called ${bold(`"${HELPER_NAME}"`)} for moodlemobile:// links, for your
    Windows account only (no admin rights). It's a two-line PowerShell script that saves the
    link to a file for the setup to read. It's removed as soon as the link arrives, and if the
    Moodle app was set up for these links, that setting is put back.`;
  }
  return `  - The setup adds a hidden launcher called ${bold(`"${HELPER_NAME}"`)} (a .desktop file in
    ~/.local/share/applications) for moodlemobile:// links. It runs a two-line shell script
    that saves the link to a file for the setup to read. It's removed as soon as the link
    arrives, and the previous handler for these links, if any, is put back.`;
}

function browserPrompt() {
  // Chrome and Edge on Linux always name xdg-open, the system tool that hands links to apps.
  if (PLATFORM === "linux") {
    return `The browser then asks whether to open the link (Chrome and Edge say ${bold('"xdg-open"')},
    Firefox says ${bold(`"${HELPER_NAME}"`)}). Click ${bold("Open")} (or Allow).`;
  }
  return `The browser then asks whether to open ${bold(`"${HELPER_NAME}"`)}. Click ${bold("Open")} (or Allow).`;
}

/** Returns { token, site }, or null if the link didn't arrive in time. */
async function tokenViaHelper(base) {
  console.log(`
  ${bold("What happens next:")}
${helperDescription()}
  - Your default browser opens UCL Moodle. Log in if it asks you to.
  - ${browserPrompt()}
    That's the step that hands the link to the setup: nothing happens until you click it.
`);
  await ask("Press Enter to start.");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "moodle-mcp-"));
  const callbackFile = path.join(work, "callback.txt");
  let restore = () => {};
  // Ctrl+C, a kill, or closing the terminal: remove the helper before exiting.
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const onSignal = () => { restore(); fs.rmSync(work, { recursive: true, force: true }); process.exit(130); };
  for (const sig of signals) process.once(sig, onSignal);

  let callback = "";
  try {
    restore = installHelper(work, callbackFile);
    openUrl(launchLink(base));
    process.stdout.write(`  Waiting for the link (up to ${Math.round(HELPER_WAIT_SECONDS / 60)} minutes) `);
    for (let i = 0; i < HELPER_WAIT_SECONDS * 2 && !callback; i++) {
      if (i % 10 === 0) process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 500));
      try { callback = fs.readFileSync(callbackFile, "utf8").trim(); } catch {}
    }
    process.stdout.write("\n");
  } finally {
    restore();
    for (const sig of signals) process.removeListener(sig, onSignal);
    fs.rmSync(work, { recursive: true, force: true });
  }

  if (!callback) return null;
  const token = tokenFromPaste(callback);
  if (!token) fail("Moodle sent a link without a usable token. Try the manual method.");
  ok("Got the link. The helper has been removed.");
  return { token, site: await checkToken(base, token) };
}

// ---------------------------------------------------------------- token, option 2: copy it from DevTools

async function tokenManually(base) {
  const launchUrl = launchLink(base);
  const devtools = PLATFORM === "darwin" ? "Cmd+Option+I" : "F12";
  const copied = copyToClipboard(launchUrl);

  console.log(`
  You'll copy the link from your browser's developer tools (Chrome, Edge, Firefox, Brave...):

  1. Log in to ${base} in your browser.
  2. Open a new tab, press ${devtools} to open the developer tools, and go to the ${bold("Network")} tab.
     Tick "Preserve log" if you see it.
  3. In that same tab, go to this address${copied ? " (it's already on your clipboard)" : ""}:

     ${cyan(launchUrl)}

     The page will look like nothing happened. That's expected: the browser can't open the
     moodlemobile:// link without the app. If it offers to open the Moodle app, click Cancel.
  4. In the Network tab, click the ${bold("launch.php")} request. Under Headers > Response Headers,
     copy the ${bold("location")} value. It starts with moodlemobile://token=
     (In Chrome or Edge you can also copy it from the red error in the Console tab.)
  5. Paste it below. ${dim("It stays hidden while you paste, because it gives access to your Moodle account.")}
`);

  for (let attempt = 1; ; attempt++) {
    const pasted = await ask("Paste the moodlemobile://token=... link, then press Enter:", { hidden: true });
    const token = pasted && tokenFromPaste(pasted);
    if (token) {
      try {
        const site = await checkToken(base, token);
        return { token, site };
      } catch (e) {
        if (!(e instanceof SetupError) || attempt >= 3) throw e;
        warn(`${e.message.replace(/\.?$/, ".")} Open the address from step 3 again and copy the new link.`);
        continue;
      }
    }
    if (attempt >= 3) {
      fail(`That still isn't a Moodle token link. Run "${RERUN}" again when you have the moodlemobile://token=... link.`);
    }
    warn(pasted
      ? "That doesn't contain a Moodle token. Copy the whole location value, starting with moodlemobile://token="
      : "Nothing was pasted.");
    if (/login|microsoft|sso/i.test(pasted)) {
      info("It looks like you copied a login page address: log in to Moodle first, then open the address from step 3 again.");
    }
  }
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

  console.log(`
  ${bold("Before you start: you need a Cloudflare account")} ${dim("(free, no credit card)")}

  Your MCP server runs on Cloudflare Workers, Cloudflare's free hosting for small programs.
  It runs on Cloudflare's servers, not your computer, so Claude or ChatGPT can reach it at any
  time, even when your computer is off, and you don't have to host anything yourself.

  The free plan allows 100,000 requests a day. You should always be the only user of the mcp
  since it's sensitive, so you'll never hit the plan limit.

  If you don't have an account yet, create one now: ${cyan(CF_SIGNUP)}
  Signing up first avoids login problems later, when the setup connects to Cloudflare.`);
  await ask("Press Enter once you have an account.");

  // 1. credentials
  step(1, "Getting your UCL Moodle token");
  const base = MOODLE;
  const { token, site } = await getToken(base);
  ok(`Logged in as ${site.fullname} on ${site.sitename}`);

  // 2. cloudflare worker
  releaseInput(); // wrangler needs the terminal from here
  step(2, "Deploying your Cloudflare Worker");
  console.log(`
  This step uses ${bold("Wrangler")}, Cloudflare's official command-line tool (installed with the other
  dependencies below). If you're not logged in yet, it opens Cloudflare in your browser and asks
  you to allow it access to your account: click ${bold("Allow")}. Then it uploads your server and stores
  your Moodle token on Cloudflare as an encrypted secret.
`);
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
  let deploy = await run("npx", ["wrangler", "deploy"], { capture: true });
  // A brand-new Cloudflare account has no workers.dev subdomain yet. Cloudflare creates one during
  // that first deploy, but the deploy itself still fails, and how long the subdomain takes to become
  // usable varies a lot between accounts. Cloudflare offers no "ready" callback, so poll: redeploy
  // (idempotent) every 10 seconds until it goes through or we give up.
  if (deploy.code !== 0 && /subdomain/i.test(deploy.out)) {
    info(`Cloudflare is setting up your workers.dev address (first deploy only). This can take up to ${Math.round(SUBDOMAIN_WAIT_SECONDS / 60)} minutes.`);
    const deadline = Date.now() + SUBDOMAIN_WAIT_SECONDS * 1000;
    for (let retry = 1; Date.now() < deadline; retry++) {
      await new Promise((r) => setTimeout(r, 10_000));
      process.stdout.write(`\r  Waiting for the Cloudflare route to be deployed (retry ${retry})...`);
      deploy = await run("npx", ["wrangler", "deploy"], { capture: true, echo: false });
      if (deploy.code === 0 || !/subdomain/i.test(deploy.out)) break; // ready, or a different error
    }
    process.stdout.write("\n");
    if (deploy.code !== 0) process.stderr.write(deploy.out); // show the last attempt's error
  }
  if (deploy.code !== 0) {
    fail("wrangler deploy failed (see above). If it mentions a workers.dev subdomain, open " +
      "https://dash.cloudflare.com -> Workers & Pages, check that a workers.dev subdomain exists, then run this again.");
  }
  let workerUrl = /https:\/\/[A-Za-z0-9.-]+\.workers\.dev/.exec(deploy.out)?.[0];
  if (!workerUrl) {
    warn("Could not read the Worker URL from the deploy output.");
    workerUrl = (await ask("Paste your Worker URL (https://moodle-mcp.<you>.workers.dev):")).replace(/\/+$/, "");
    releaseInput();
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

  ${dim(`Moodle tokens can expire. If the tools start saying "Invalid Moodle token", just run "${RERUN}" again.`)}
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
    process.exitCode = 1; // not process.exit(): forcing it while stdin is closing crashes Node on Windows
  });
}
