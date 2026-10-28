



# moodle-mcp

[![npm version](https://img.shields.io/npm/v/moodle-mcp?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/moodle-mcp)
[![npm downloads](https://img.shields.io/npm/dm/moodle-mcp?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/moodle-mcp)
[![GitHub stars](https://img.shields.io/github/stars/1alexandrer/moodle-mcp?style=social)](https://github.com/1alexandrer/moodle-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node](https://img.shields.io/badge/Node-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![MIT License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

> Give Claude full access to your Moodle — courses, files, assignments, grades, quizzes, calendar, and more. Build Obsidian study vaults from your lecture notes in one command.

> 📦 **[moodle-mcp on npm](https://www.npmjs.com/package/moodle-mcp)** — `npx moodle-mcp`

**14 tools · 5 prompts · MCP Resources · read-only**

> 🍴 **This is a fork of [1alexandrer/moodle-mcp](https://github.com/1alexandrer/moodle-mcp)** that adds a [self-hosted Docker deployment](#self-hosting-with-docker) with an authenticated endpoint and a [read-only guard](#read-only-guard) that blocks uploads and any other write to Moodle.


---

## Install

### Step 1 — Get your Moodle token

See [Getting Your Token](#getting-your-token) below. You'll need this for any install method.

### Step 2 — Pick your delivery mode

**Option A — Local (zero hosting):** Runs `npx moodle-mcp` on your machine each time your MCP client starts. No server, no cost, nothing to deploy.

**Option B — Hosted (Cloudflare Worker):** Deploy once, get a permanent URL. Your MCP client connects to the URL — no `npx` on the client side.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/ )

After deploying, set `MOODLE_URL` and `MOODLE_TOKEN` as [secrets in the CF dashboard](https://dash.cloudflare.com/) or via:
```bash
npx wrangler secret put MOODLE_URL
npx wrangler secret put MOODLE_TOKEN
npm run deploy
```
Your URL will be `https://moodle-mcp.<your-subdomain>.workers.dev`.

> ⚠️ The Cloudflare Worker endpoint has **no authentication**: anyone who learns the URL can read your Moodle with your token. Prefer Option C if you can.

**Option C — Self-hosted (Docker, recommended for hosting):** Run it on any VPS / home server with Docker. The endpoint is protected by a secret key and the [read-only guard](#read-only-guard) is on by default. See [Self-hosting with Docker](#self-hosting-with-docker). Your URL will be `https://<your-host>/<MCP_AUTH_SECRET>/mcp`; use it anywhere the client examples below show a hosted URL.

### Step 3 — Configure your MCP client

<details>
<summary><strong>Claude Desktop</strong></summary>

Config file:
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Option A — Local:**
```json
{
  "mcpServers": {
    "moodle": {
      "command": "npx",
      "args": ["-y", "moodle-mcp"],
      "env": {
        "MOODLE_URL": "https://moodle.yourschool.edu",
        "MOODLE_TOKEN": "your_token_here"
      }
    }
  }
}
```

**Option B — Hosted:**
```json
{
  "mcpServers": {
    "moodle": {
      "url": "https://moodle-mcp.your-subdomain.workers.dev"
    }
  }
}
```
</details>

<details>
<summary><strong>Claude Code (CLI)</strong></summary>

**Option A — Local:**
```bash
claude mcp add moodle npx -- -y moodle-mcp \
  -e MOODLE_URL=https://moodle.yourschool.edu \
  -e MOODLE_TOKEN=your_token_here
```

**Option B — Hosted:**
```bash
claude mcp add moodle --transport http https://moodle-mcp.your-subdomain.workers.dev
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

Config file: `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project)

**Option A — Local:**
```json
{
  "mcpServers": {
    "moodle": {
      "command": "npx",
      "args": ["-y", "moodle-mcp"],
      "env": {
        "MOODLE_URL": "https://moodle.yourschool.edu",
        "MOODLE_TOKEN": "your_token_here"
      }
    }
  }
}
```

**Option B — Hosted:**
```json
{
  "mcpServers": {
    "moodle": {
      "url": "https://moodle-mcp.your-subdomain.workers.dev"
    }
  }
}
```
</details>

<details>
<summary><strong>VS Code</strong></summary>

Config file: `.vscode/mcp.json` in your project, or `settings.json` globally.

**Option A — Local:**
```json
{
  "servers": {
    "moodle": {
      "command": "npx",
      "args": ["-y", "moodle-mcp"],
      "env": {
        "MOODLE_URL": "https://moodle.yourschool.edu",
        "MOODLE_TOKEN": "your_token_here"
      }
    }
  }
}
```

**Option B — Hosted:**
```json
{
  "servers": {
    "moodle": {
      "url": "https://moodle-mcp.your-subdomain.workers.dev"
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Config file: `~/.codeium/windsurf/mcp_config.json`

**Option A — Local:**
```json
{
  "mcpServers": {
    "moodle": {
      "command": "npx",
      "args": ["-y", "moodle-mcp"],
      "env": {
        "MOODLE_URL": "https://moodle.yourschool.edu",
        "MOODLE_TOKEN": "your_token_here"
      }
    }
  }
}
```

**Option B — Hosted:**
```json
{
  "mcpServers": {
    "moodle": {
      "url": "https://moodle-mcp.your-subdomain.workers.dev"
    }
  }
}
```
</details>

<details>
<summary><strong>Zed</strong></summary>

Config file: `~/.config/zed/settings.json`

**Option A — Local:**
```json
{
  "context_servers": {
    "moodle": {
      "command": {
        "path": "npx",
        "args": ["-y", "moodle-mcp"],
        "env": {
          "MOODLE_URL": "https://moodle.yourschool.edu",
          "MOODLE_TOKEN": "your_token_here"
        }
      }
    }
  }
}
```

**Option B — Hosted:**
```json
{
  "context_servers": {
    "moodle": {
      "url": "https://moodle-mcp.your-subdomain.workers.dev"
    }
  }
}
```
</details>

<details>
<summary><strong>Continue.dev</strong></summary>

Config file: `~/.continue/config.json`

**Option A — Local:**
```json
{
  "mcpServers": [
    {
      "name": "moodle",
      "command": "npx",
      "args": ["-y", "moodle-mcp"],
      "env": {
        "MOODLE_URL": "https://moodle.yourschool.edu",
        "MOODLE_TOKEN": "your_token_here"
      }
    }
  ]
}
```

**Option B — Hosted:**
```json
{
  "mcpServers": [
    {
      "name": "moodle",
      "url": "https://moodle-mcp.your-subdomain.workers.dev"
    }
  ]
}
```
</details>

<details>
<summary><strong>Cline</strong></summary>

Open the Cline sidebar in VS Code → MCP Servers → Add Server → paste the JSON:

**Option A — Local:**
```json
{
  "moodle": {
    "command": "npx",
    "args": ["-y", "moodle-mcp"],
    "env": {
      "MOODLE_URL": "https://moodle.yourschool.edu",
      "MOODLE_TOKEN": "your_token_here"
    }
  }
}
```

**Option B — Hosted:**
```json
{
  "moodle": {
    "url": "https://moodle-mcp.your-subdomain.workers.dev"
  }
}
```
</details>

<details>
<summary><strong>ChatGPT — Coming soon</strong></summary>

OpenAI has announced MCP support for ChatGPT. Check the [OpenAI blog](https://openai.com/blog) for the release date. Once available, the hosted URL option (Option B) will work directly.
</details>

---

## Getting Your Token

Every method below ends with a **32-character hex string** (e.g. `0123456789abcdef0123456789abcdef`). That string, and nothing else, goes in `MOODLE_TOKEN`.

You can check a token before using it:
```bash
curl -s "https://moodle.yourschool.edu/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=core_webservice_get_site_info" \
  --data-urlencode "wstoken=YOUR_TOKEN" | head -c 200
```
A valid token returns your `sitename`; `"errorcode":"invalidtoken"` means the token is wrong, expired or revoked.

### Option A — Security keys page (if your school shows it)

1. Log in to your school's Moodle in a browser
2. Open `https://moodle.yourschool.edu/user/managetoken.php` (**Profile → Preferences → Security keys**)
3. Copy the token for **Moodle mobile web service**

Many schools hide this page or don't list the mobile service. If so, use Option B.

### Option B — Browser launch URL (works with SSO: Microsoft, Google, Shibboleth…)

This uses the same login flow as the official Moodle app.

1. In a desktop browser (Chrome/Edge/Firefox), log in to your Moodle normally.
2. Open DevTools (**F12**) → **Console** tab, and keep it open.
3. In the **same tab**, go to:
   ```
   https://moodle.yourschool.edu/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=12345&urlscheme=moodlemobile
   ```
   The page appears to do nothing: Moodle is trying to redirect to the app.
4. The Console shows an error with a URL like `moodlemobile://token=BASE64STRING`. Copy everything after `token=`.
   If nothing appears, look in the **Network** tab for the `launch.php` request and copy its `Location` response header.
5. Decode it in the Console:
   ```js
   atob("BASE64STRING")
   ```
   The result looks like `signature:::TOKEN` or `signature:::TOKEN:::privatetoken`.
   **Use only the middle 32-character `TOKEN` part.** Pasting the whole string gives `invalidtoken`.

If the page says the mobile app is not enabled / not allowed, your school has blocked mobile access and none of these methods will work.

### Option C — `login/token.php` (non-SSO schools only)

```bash
curl -s "https://moodle.yourschool.edu/login/token.php" \
  --data-urlencode "username=YOUR_USERNAME" \
  --data-urlencode "password=YOUR_PASSWORD" \
  --data-urlencode "service=moodle_mobile_app"
```
Returns `{"token":"...","privatetoken":"..."}`; use `token`. Use POST as shown rather than putting your password in a URL (it ends up in browser history and server logs).

For the local `npx` mode only, non-SSO users can also skip the token and set `MOODLE_USERNAME` + `MOODLE_PASSWORD` instead. The hosted modes (Cloudflare and Docker) require `MOODLE_TOKEN`.

> ⚠️ **SSO schools**: if your login page redirects to Microsoft, Google or another identity provider, Option C will not work. Use Option B.

### Token lifetime

Tokens are invalidated when you reset them on the Security keys page, and often when you log out of the Moodle app or when the school's token expiry passes. If tools start returning `Invalid Moodle token`, get a new one and restart the server.

---

## Tools

| Tool | Description | Params |
|------|-------------|--------|
| `moodle_get_site_info` | School name, Moodle version, which APIs are enabled | — |
| `moodle_list_courses` | All your enrolled courses | — |
| `moodle_get_course` | Sections and all activities in a course, with `moduleId`s | `courseId` |
| `moodle_list_resources` | Files and links grouped by section — returns opaque `fileId`s | `courseId` |
| `moodle_download_file` | Read a file by its `fileId` — returns text for text/JSON/XML, base64 for PDFs/DOCX/images | `fileId` |
| `moodle_get_page` | Read the text of a Page activity | `courseId`, `moduleId` |
| `moodle_get_book` | Read a Book activity — table of contents plus chapter text | `courseId`, `moduleId`, `chapterId?` |
| `moodle_list_assignments` | Assignments with due dates, grouped by section | `courseId` |
| `moodle_get_assignment` | Submission status and grade feedback | `assignmentId` |
| `moodle_get_grades` | Full grade report with categories and feedback | `courseId` |
| `moodle_get_calendar_events` | Upcoming events across courses | `courseId?`, `daysAhead?` |
| `moodle_list_quizzes` | Quizzes with time limits and open dates | `courseId` |
| `moodle_get_quiz_attempts` | Your past attempt grades and states | `quizId` |
| `moodle_list_forums` | Forum activities in a course | `courseId` |
| `moodle_get_forum_discussions` | Recent discussions in a forum | `forumId` |
| `moodle_get_notifications` | Recent notifications (grades, feedback, replies) | `limit?` |

---

## Prompts

Use these in any MCP client that supports prompts (Claude Desktop, VS Code with Copilot, etc.):

| Prompt | Use case | Example |
|--------|----------|---------|
| `summarize-course` | Full course overview organized by section | `/summarize-course courseId=42` |
| `whats-due` | Prioritized due dates this week / next week | `/whats-due` or `/whats-due courseId=42` |
| `build-study-notes` | Build a linked Obsidian vault from course materials | `/build-study-notes courseId=42 vaultPath=~/obsidian/finals` |
| `exam-prep` | Topic-by-topic study guide based on grades and quiz results | `/exam-prep courseId=42` |
| `search-notes` | Natural language search across all course files | `/search-notes courseId=42 query="derivatives and limits"` |

---

## Obsidian Finals Prep

> Turn your entire semester into a linked knowledge graph in one command.

### Setup

1. **Install [Obsidian](https://obsidian.md)** (free, works on Mac/Windows/Linux)
2. Create a new vault, e.g. `~/obsidian/finals`
3. Make sure `moodle-mcp` is connected to your MCP client

### Build the vault

Use the `/build-study-notes` prompt in Claude Desktop:

```
/build-study-notes courseId=42 vaultPath=~/obsidian/finals
```

Or paste this directly into Claude:

```
Pull my [Course Name] (course ID 42), read all the lecture notes and slides,
and build a linked Obsidian vault at ~/obsidian/finals — one note per topic,
with [[wikilinks]] between related concepts, a MOC.md index, and tags for each section.
```

Claude will:
1. Pull all your course sections, files, assignments, and grades
2. Read each PDF and document directly via the MCP resources protocol
3. Write one `.md` file per section with key concepts, definitions, and examples
4. Add `[[wikilinks]]` between related terms across notes
5. Create a `MOC.md` (Map of Content) index linking everything

### See the graph

**Option A — Obsidian Graph View** (built-in, free)

1. Open the vault in Obsidian
2. Click **Graph View** (sidebar icon or `Cmd+G`)
3. Your entire course appears as a knowledge graph — linked concepts cluster together, isolated topics stand out as things to review

**Option B — Graphify** (richer visual graph)

1. Install [Graphify](https://graphify.app) — it reads the same `.md` files Obsidian writes
2. Point it at your vault folder (`~/obsidian/finals`)
3. Drag to explore connections; click any node to open the note and ask Claude about it

Both tools read the same Markdown vault — you can use both.

### Knowledge Graph preview


<img width="1565" height="947" alt="image" src="https://github.com/user-attachments/assets/382cf5ed-4806-4d3a-bfdc-6e4eeb15c3ec" />
*Your entire course as a linked knowledge graph — built in one command. Run `/build-study-notes` once to generate this.*

### Query the graph with Claude

Once the vault exists on disk, you can ask Claude Code or Claude Desktop questions like:

```
Explain the relationship between [[topic A]] and [[topic B]] in my course notes at ~/obsidian/finals
```

```
Based on my notes in ~/obsidian/finals, which topics do I need to review most before the exam?
```

Claude reads your `.md` files directly and reasons across the full linked graph.

### Natural language search

Once the vault is built, you can ask Claude to find specific content:

```
/search-notes courseId=42 query="the central limit theorem and when to use it"
```

Claude will look through all your course materials, find the relevant files, read them, and synthesize a direct answer.

---

## Compatibility

Some tools require your Moodle admin to enable specific web services. Run `moodle_get_site_info` to see which tools are available on your school's Moodle.

| Tool | Required | Notes |
|------|----------|-------|
| `moodle_list_courses`, `moodle_get_course`, `moodle_list_resources`, `moodle_download_file`, `moodle_get_page`, `moodle_get_book` | Always available | Core Moodle WS |
| `moodle_list_assignments`, `moodle_get_assignment` | Admin must enable | `mod_assign` service |
| `moodle_get_grades` | Admin must enable | `gradereport_user` service |
| `moodle_get_calendar_events` | Usually available | `core_calendar` service |
| `moodle_list_quizzes`, `moodle_get_quiz_attempts` | Admin may need to enable | `mod_quiz` service |
| `moodle_get_forum_discussions` | Admin may need to enable | `mod_forum` service |
| `moodle_get_notifications` | Admin may need to enable | `message_popup` service |

If a tool isn't available, it returns a helpful message explaining what your admin needs to enable — it won't crash the server.


---

## Security & file access (v0.2)

Tool responses never contain raw or authenticated Moodle file URLs. Instead, `moodle_list_resources` returns opaque `fileId`s — AES-GCM-sealed envelopes bound to your Moodle account via the access token. Pass a `fileId` to `moodle_download_file`, and the server:

1. Decrypts the `fileId` and checks it was issued to you (not another user).
2. Re-checks with Moodle that the file is still visible to you (catches unenrolment, hidden modules, removed files).
3. Refuses anything that isn't a `pluginfile.php` URL on your Moodle host (no SSRF relay).
4. Fetches the file server-side with the token attached to the outbound request only — the token never appears in anything returned to the MCP client.
5. Returns text for text/JSON/XML MIMEs, or the bytes as an MCP embedded resource (base64) for PDFs/DOCX/images.

This fixes the "domain not in the list of allowed fetch" error seen with Claude.ai's beta connectors when a chat tried to open a Moodle-hosted PDF: Claude no longer has to fetch anything cross-origin, because the content arrives inside the MCP response.

**Limits:** 25 MB per file by default (override with `MOODLE_MCP_MAX_FILE_MB=<positive number>`). File IDs expire after 24 hours. Rotating your Moodle token invalidates all outstanding IDs.



## Read-only guard

The tools only *read* from Moodle: they call 11 `*_get_*` web-service functions and download files from `pluginfile.php`. Nothing uploads, submits, posts or messages.

The Moodle token itself is far more powerful, though: a mobile-app token can upload files, submit assignments and post in forums. So the Docker deployment adds a guard ([`docker/guard.mjs`](docker/guard.mjs)) that wraps every outbound request the server makes and, by default, only lets through:

| Allowed | Everything else |
|---|---|
| `webservice/rest/server.php` calls whose `wsfunction` is on the allowlist below | **Blocked** before leaving the container, e.g. `webservice/upload.php`, `login/token.php`, `mod_assign_save_submission`, `mod_forum_add_discussion_post`, any non-Moodle host |
| `GET`/`HEAD` on `pluginfile.php` on your Moodle host | |

Allowlist: `core_webservice_get_site_info`, `core_enrol_get_users_courses`, `core_course_get_contents`, `core_calendar_get_action_events_by_timesort`, `gradereport_user_get_grade_items`, `message_popup_get_popup_notifications`, `mod_assign_get_assignments`, `mod_assign_get_submission_status`, `mod_forum_get_forum_discussions`, `mod_quiz_get_quizzes_by_courses`, `mod_quiz_get_user_attempts`.

| Variable | Default | Effect |
|---|---|---|
| `MOODLE_ALLOW_WRITES` | `false` | `true` disables the guard entirely (not recommended) |
| `MOODLE_WS_EXTRA_ALLOWED` | empty | Comma-separated extra **read-only** functions to allow, e.g. if an upstream update adds a tool that fails with `Blocked by read-only guard` |

Blocked attempts are logged as `[guard] blocked: …` (`docker compose logs | grep guard`).

The guard is part of the Docker deployment only; the `npx` and Cloudflare Worker modes run without it.

---

## Self-hosting with Docker

Runs the same Streamable HTTP handler as the Cloudflare Worker, on Node, in a container. Works on any Linux box with Docker (x86_64 or ARM, e.g. an Oracle Cloud Ampere instance).

What the container adds on top of the Worker:
- **Endpoint authentication**: every request must carry the secret key, either in the path (`/<MCP_AUTH_SECRET>/mcp`) or as `Authorization: Bearer <MCP_AUTH_SECRET>`. Anything else gets a plain `404`. The path form is what Claude.ai custom connectors need, since they cannot send custom headers.
- **The [read-only guard](#read-only-guard)**.
- `GET /healthz` for monitoring (no auth, returns `ok`).

### 1. Configure

```bash
git clone https://github.com/dussud/moodle-mcp.git
cd moodle-mcp
cp .env.example .env
chmod 600 .env
sed -i "s/^MCP_AUTH_SECRET=.*/MCP_AUTH_SECRET=$(openssl rand -hex 24)/" .env
nano .env   # set MOODLE_URL and MOODLE_TOKEN
```

### 2a. Run behind your own reverse proxy

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/healthz   # -> ok
```

The container listens on `127.0.0.1:3000` only. Put a TLS reverse proxy in front of it, for example with Caddy (automatic HTTPS):

```
moodle-mcp.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx works too; disable buffering so streamed responses pass straight through (`proxy_buffering off;`).

### 2b. Run behind an existing Traefik

If the host already runs Traefik with a Let's Encrypt resolver, set `MCP_HOST`, `TRAEFIK_NETWORK` (the Docker network Traefik is on) and `TRAEFIK_CERTRESOLVER` in `.env`, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

### 3. DNS and firewall

- Point an `A` record for your host at the server's public IP. Behind Cloudflare, use **DNS only** (grey cloud), at least until the certificate is issued: Let's Encrypt's TLS-ALPN challenge does not work through the Cloudflare proxy.
- Open ports 80/443. On Oracle Cloud this means **both** the VCN security list / NSG ingress rules and the instance firewall (`iptables` / `netfilter-persistent`).

### 4. Connect

Your MCP URL is:
```
https://moodle-mcp.example.com/<MCP_AUTH_SECRET>/mcp
```
Print the secret with `grep MCP_AUTH_SECRET .env`. Treat the URL like a password: if it leaks, put a new `openssl rand -hex 24` value in `.env` and run `docker compose up -d`.

- **Claude.ai / Claude Desktop**: Settings → Connectors → *Add custom connector* → paste the URL.
- **Claude Code**: `claude mcp add moodle --transport http https://moodle-mcp.example.com/<MCP_AUTH_SECRET>/mcp`
- **Clients that support headers** can use `https://moodle-mcp.example.com/mcp` with `Authorization: Bearer <MCP_AUTH_SECRET>`.

Quick check from a shell:
```bash
curl -s -X POST "https://moodle-mcp.example.com/$SECRET/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"moodle_list_courses","arguments":{}}}'
```

### Updating

```bash
git pull
docker compose up -d --build        # add -f docker-compose.traefik.yml if you use it
```

### Using the prebuilt image instead of building

Every push to `master` builds a multi-arch image (`linux/amd64`, `linux/arm64`) to `ghcr.io/dussud/moodle-mcp:latest` (see [Publishing your fork on GitHub](#publishing-your-fork-on-github)). To use it, replace `build: .` with `image: ghcr.io/dussud/moodle-mcp:latest` in `docker-compose.yml`, then `docker compose pull && docker compose up -d`.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `404` on every request | Missing/wrong secret in the URL or `Authorization` header |
| `{"error":"Invalid Moodle token…"}` | Token wrong, expired, or you pasted `signature:::token`; see [Getting Your Token](#getting-your-token) |
| `{"error":"fetch failed"}` | Container cannot reach `MOODLE_URL` (DNS, typo, school firewall) |
| `Blocked by read-only guard: …` | A tool used a function that is not allowlisted; see [Read-only guard](#read-only-guard) |
| Traefik returns `404 page not found` for a few seconds after start | Traefik waits until the container health check passes |
| Browser shows a certificate error | DNS not pointing at the server yet, proxied through Cloudflare, or port 443 closed |

---

## Publishing your fork on GitHub

To make your own copy with these changes (or your own):

1. **Fork**: on GitHub click **Fork** on this repo, or with the GitHub CLI:
   ```bash
   gh repo fork dussud/moodle-mcp --clone
   cd moodle-mcp
   ```
2. **Push changes**:
   ```bash
   git add -A
   git commit -m "Describe your change"
   git push origin master
   ```
   Never commit `.env`: it holds your Moodle token. `.gitignore` already excludes it; only `.env.example` is tracked.
3. **Docker image (GitHub Actions)**: [`.github/workflows/docker.yml`](.github/workflows/docker.yml) builds and pushes `ghcr.io/<you>/moodle-mcp` on every push to `master` and on `v*` tags. On a fork, enable it once under **Actions** → *I understand my workflows, go ahead and enable them*. New packages are private by default: either make it public (**Packages** → moodle-mcp → *Package settings* → *Change visibility*), or log in on the server with a PAT that has `read:packages`:
   ```bash
   echo "$GHCR_PAT" | docker login ghcr.io -u <your-github-user> --password-stdin
   ```
4. **Stay in sync with upstream**:
   ```bash
   git remote add upstream https://github.com/1alexandrer/moodle-mcp.git   # once
   git fetch upstream
   git merge upstream/master
   git push origin master
   ```
   Or use **Sync fork** on the GitHub page. After merging, check whether new tools need functions added to `MOODLE_WS_EXTRA_ALLOWED`; any that write to Moodle should stay blocked.

---

## Contributing

Issues and PRs welcome. Open an issue first for large changes. For changes to the server itself, consider contributing to [upstream](https://github.com/1alexandrer/moodle-mcp).

MIT License — © 2026 Alexandre Ribeiro
