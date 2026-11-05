# UCL Moodle MCP

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node](https://img.shields.io/badge/Node-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![MIT License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

An MCP server that lets Claude or ChatGPT read your [UCL Moodle](https://moodle.ucl.ac.uk): courses, files, assignments, grades, quizzes, calendar and forums. It is read-only and has 17 tools and 5 prompts.

This is a fork of [1alexandrer/moodle-mcp](https://github.com/1alexandrer/moodle-mcp) that only supports UCL Moodle. On top of upstream it adds:

- a setup command, `npm create ucl-moodle-mcp`, that gets your token through UCL's single sign-on and deploys your own private server
- a secret in the server URL, so only you can use your Cloudflare Worker or Docker deployment
- a [Docker deployment](#self-hosting-with-docker) with a [read-only guard](#read-only-guard) that blocks uploads and any other write to Moodle

If you're at another university, use [upstream](https://github.com/1alexandrer/moodle-mcp), which works with any Moodle site.

## Quick start

You need:

- [Node.js 18 or newer](https://nodejs.org) (the LTS version is fine)
- a free [Cloudflare account](https://dash.cloudflare.com/sign-up/workers-and-pages)
- to be logged in to [UCL Moodle](https://moodle.ucl.ac.uk) in your default browser

Then run this in a terminal (PowerShell on Windows, Terminal on macOS):

```bash
npm create ucl-moodle-mcp
```

The setup does three things:

1. It opens a Moodle login link in your default browser and catches your token. This is the same link the official Moodle app uses (see [Getting your token](#getting-your-token)). Your browser may ask whether to open a `moodlemobile` link. Click Open or Allow. If you're not logged in to Moodle, it stops and asks you to log in first.
2. It asks you to log in to Cloudflare (the first time only), deploys your own Cloudflare Worker and stores your token there as an encrypted secret.
3. It prints your MCP URL, which looks like `https://moodle-mcp.<you>.workers.dev/<secret>/mcp`.

**Don't share that URL.** It's tied to your Moodle account, and anyone who has it can read your courses, files, grades and messages as you. If it leaks, run `npm create ucl-moodle-mcp` again. You'll get a new URL and the old one stops working.

Run the same command again when your token expires (the tools start answering `Invalid Moodle token`). If you have a clone of this repo, `npm run setup` does the same thing.

## Connect your AI assistant

Add your MCP URL to your assistant:

- **Claude** (web, desktop and mobile): Settings > Connectors > Add custom connector, then paste the URL. See [Anthropic's guide](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp).
- **ChatGPT**: add a custom MCP server with the URL and no authentication. See [OpenAI's guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
- **Claude Code**:
  ```bash
  claude mcp add moodle --transport http https://moodle-mcp.<you>.workers.dev/<secret>/mcp
  ```
- **Cursor, VS Code, Windsurf, Cline, Continue and others**: add a remote MCP server with the URL. In Cursor, for example, put this in `~/.cursor/mcp.json`:
  ```json
  { "mcpServers": { "moodle": { "url": "https://moodle-mcp.<you>.workers.dev/<secret>/mcp" } } }
  ```

## Getting your token

UCL Moodle logs you in through UCL's single sign-on, so the only way to get a token is the one the official Moodle app uses: the mobile-app launch link. `npm create ucl-moodle-mcp` does this for you. Here are the manual steps in case you need them.

1. In a desktop browser (Chrome, Edge or Firefox), log in to [UCL Moodle](https://moodle.ucl.ac.uk).
2. Open DevTools (F12) and go to the Console tab. Keep it open.
3. In the same tab, go to:
   ```
   https://moodle.ucl.ac.uk/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=12345&urlscheme=moodlemobile
   ```
   The page seems to do nothing, because Moodle is trying to hand you over to the app.
4. The Console shows an error with a URL like `moodlemobile://token=BASE64STRING`. Copy everything after `token=`.
   If nothing shows up, look in the Network tab for the `launch.php` request and copy its `Location` response header.
5. Decode it in the Console:
   ```js
   atob("BASE64STRING")
   ```
   You get `signature:::TOKEN` or `signature:::TOKEN:::privatetoken`. Use only the middle part, the 32-character `TOKEN`. Pasting the whole string gives `invalidtoken`.

To check a token:

```bash
curl -s "https://moodle.ucl.ac.uk/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=core_webservice_get_site_info" \
  --data-urlencode "wstoken=YOUR_TOKEN" | head -c 200
```

A valid token returns `"sitename"`. If you get `"errorcode":"invalidtoken"`, the token is wrong, expired or revoked.

Tokens stop working when they expire or when you log out of the Moodle app. Get a new one, or rerun the setup.

## Other ways to run it

The server only talks to `https://moodle.ucl.ac.uk`. You don't need to set `MOODLE_URL`, and the server refuses to start if it's set to another site. Every mode below only needs `MOODLE_TOKEN`.

### Cloudflare Worker, by hand

These are the steps `npm create ucl-moodle-mcp` runs for you:

```bash
git clone https://github.com/dussud/moodle-mcp.git
cd moodle-mcp
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put MOODLE_TOKEN
npx wrangler secret put MCP_AUTH_SECRET     # for example the output of: openssl rand -hex 32
```

Your URL is `https://moodle-mcp.<your-subdomain>.workers.dev/<MCP_AUTH_SECRET>/mcp`. Requests without the secret get a `404`. Clients that can send headers can use `/mcp` with `Authorization: Bearer <MCP_AUTH_SECRET>` instead.

If you skip `MCP_AUTH_SECRET`, the Worker has no authentication at all, and anyone who finds the URL can read your Moodle with your token.

### Local, on your own computer

The server starts on your machine whenever your MCP client starts. This only works with desktop clients such as Claude Desktop, Claude Code and Cursor, not with Claude on the web or ChatGPT.

```bash
git clone https://github.com/dussud/moodle-mcp.git
cd moodle-mcp
npm install && npm run build
```

Then add it to your client's config. For Claude Desktop that's `claude_desktop_config.json`, in `~/Library/Application Support/Claude/` on macOS or `%APPDATA%\Claude\` on Windows:

```json
{
  "mcpServers": {
    "moodle": {
      "command": "node",
      "args": ["/absolute/path/to/moodle-mcp/dist/server.js"],
      "env": { "MOODLE_TOKEN": "your_token_here" }
    }
  }
}
```

For Claude Code:

```bash
claude mcp add moodle -e MOODLE_TOKEN=your_token_here -- node /absolute/path/to/moodle-mcp/dist/server.js
```

### Docker, on your own server

This mode includes the read-only guard. See [Self-hosting with Docker](#self-hosting-with-docker).

## Tools

| Tool | What it does | Parameters |
|------|--------------|------------|
| `moodle_get_site_info` | Site name, Moodle version and which APIs are enabled | none |
| `moodle_list_courses` | Your enrolled courses | none |
| `moodle_get_course` | Course outline: sections (with `sectionId` and a text preview), activities and labels (with `moduleId`) | `courseId` |
| `moodle_get_section` | One section in full: its text (timetables, calendars), every label, and activity descriptions | `courseId`, `sectionId` |
| `moodle_list_resources` | Files and links grouped by section, each with a `fileId` | `courseId` |
| `moodle_download_file` | Reads a file by its `fileId`. Returns text for text files, extracted text for PDF and DOCX, and images as images | `fileId` |
| `moodle_get_page` | Text of a Page activity | `courseId`, `moduleId` |
| `moodle_get_book` | A Book activity: table of contents and chapter text | `courseId`, `moduleId`, `chapterId` (optional) |
| `moodle_list_assignments` | Assignments with due dates, grouped by section | `courseId` |
| `moodle_get_assignment` | Submission status and grade feedback | `assignmentId` |
| `moodle_get_grades` | Grade report with categories and feedback | `courseId` |
| `moodle_get_calendar_events` | Upcoming events across your courses | `courseId`, `daysAhead` (both optional) |
| `moodle_list_quizzes` | Quizzes with time limits and opening dates | `courseId` |
| `moodle_get_quiz_attempts` | Grades and states of your past attempts | `quizId` |
| `moodle_list_forums` | Forums in a course | `courseId` |
| `moodle_get_forum_discussions` | Recent discussions in a forum | `forumId` |
| `moodle_get_notifications` | Recent notifications (grades, feedback, replies) | `limit` (optional) |

## Prompts

These come from upstream. You can use them in clients that support MCP prompts, such as Claude Desktop or VS Code with Copilot.

| Prompt | What it does | Example |
|--------|--------------|---------|
| `summarize-course` | Overview of a course, section by section | `/summarize-course courseId=42` |
| `whats-due` | What's due this week and next, most urgent first | `/whats-due` or `/whats-due courseId=42` |
| `build-study-notes` | Builds a linked Obsidian vault from a course's materials | `/build-study-notes courseId=42 vaultPath=~/obsidian/finals` |
| `exam-prep` | Study guide by topic, based on your grades and quiz results | `/exam-prep courseId=42` |
| `search-notes` | Searches a course's files for an answer to a question | `/search-notes courseId=42 query="derivatives and limits"` |

## Study notes in Obsidian

The `build-study-notes` prompt turns a course into a folder of linked Markdown notes you can open in [Obsidian](https://obsidian.md) (free, on Windows, macOS and Linux).

1. Install Obsidian and create a vault, for example `~/obsidian/finals`.
2. Connect this server to your assistant.
3. Run:
   ```
   /build-study-notes courseId=42 vaultPath=~/obsidian/finals
   ```
   Or ask in plain words:
   ```
   Read the lecture notes and slides from my course 42 and build an Obsidian vault at
   ~/obsidian/finals: one note per topic, [[wikilinks]] between related ideas, a MOC.md
   index and a tag for each section.
   ```

The assistant reads the course sections and files, writes one note per section with the main ideas, definitions and examples, links related notes with `[[wikilinks]]`, and adds a `MOC.md` index. Writing the files needs an assistant that can write to your disk, such as Claude Code or Claude Desktop with file access.

Open the vault in Obsidian and use Graph View (Ctrl/Cmd+G) to see how the topics connect. Notes with few links are often the ones worth reviewing.

<img width="1565" height="947" alt="Obsidian graph view of a course vault" src="https://github.com/user-attachments/assets/382cf5ed-4806-4d3a-bfdc-6e4eeb15c3ec" />

Once the vault exists, you can ask questions about it, for example:

```
Based on my notes in ~/obsidian/finals, which topics should I review before the exam?
```

## What works on UCL Moodle

Some tools depend on web services that the Moodle admins choose to enable. Run `moodle_get_site_info` to see what's available.

| Tools | Moodle service |
|-------|----------------|
| `moodle_list_courses`, `moodle_get_course`, `moodle_list_resources`, `moodle_download_file`, `moodle_get_section`, `moodle_get_page`, `moodle_get_book` | Core services, always on |
| `moodle_list_assignments`, `moodle_get_assignment` | `mod_assign` |
| `moodle_get_grades` | `gradereport_user` |
| `moodle_get_calendar_events` | `core_calendar` |
| `moodle_list_quizzes`, `moodle_get_quiz_attempts` | `mod_quiz` |
| `moodle_get_forum_discussions` | `mod_forum` |
| `moodle_get_notifications` | `message_popup` |

If a service is turned off, the tool says which one is missing instead of failing.

## Security and file access

Tool responses never contain Moodle file URLs. `moodle_list_resources` returns a `fileId` for each file instead. A `fileId` is encrypted (AES-GCM) and tied to your account through your token. When you pass one to `moodle_download_file`, the server:

1. Decrypts it and checks that it was issued to you.
2. Asks Moodle whether you can still see the file. This catches unenrolment, hidden modules and deleted files.
3. Refuses anything that isn't a `pluginfile.php` URL on `moodle.ucl.ac.uk`, so the server can't be used to fetch other sites.
4. Downloads the file itself, adding your token only to that request. The token never appears in anything sent back to the assistant.
5. Returns text for text, JSON and XML files, extracted text for PDF and DOCX (Claude won't accept those as attachments), images as images, and anything else as a base64 attachment.

Because the content comes back inside the MCP response, Claude never has to fetch Moodle URLs itself. That avoids the "domain not in the list of allowed fetch" error Claude shows for Moodle-hosted PDFs.

Files are limited to 25 MB by default. You can change this with `MOODLE_MCP_MAX_FILE_MB`. A `fileId` expires after 24 hours, and all of them stop working if your token changes.

## Read-only guard

The tools only read from Moodle. They call 12 web-service functions and download files from `pluginfile.php`. None of them upload, submit, post or send messages.

The token can do much more than that, though. A mobile-app token can upload files, submit assignments and post in forums. So the Docker deployment adds a guard ([`docker/guard.mjs`](docker/guard.mjs)) that checks every request the server makes to the outside world. By default it only lets these through:

- calls to `webservice/rest/server.php` whose function is on the list below
- `GET` and `HEAD` requests for `pluginfile.php` on `moodle.ucl.ac.uk`

Everything else is blocked before it leaves the container. That includes `webservice/upload.php`, `login/token.php`, `mod_assign_save_submission`, `mod_forum_add_discussion_post` and any other site.

Allowed functions: `core_webservice_get_site_info`, `core_enrol_get_users_courses`, `core_course_get_contents`, `core_calendar_get_action_events_by_timesort`, `gradereport_user_get_grade_items`, `message_popup_get_popup_notifications`, `mod_assign_get_assignments`, `mod_assign_get_submission_status`, `mod_forum_get_forum_discussions`, `mod_page_get_pages_by_courses`, `mod_quiz_get_quizzes_by_courses`, `mod_quiz_get_user_attempts`.

| Variable | Default | Effect |
|---|---|---|
| `MOODLE_ALLOW_WRITES` | `false` | `true` turns the guard off completely. Not recommended. |
| `MOODLE_WS_EXTRA_ALLOWED` | empty | Extra read-only functions to allow, comma-separated. Useful if an upstream update adds a tool that fails with `Blocked by read-only guard`. |

Blocked requests are logged as `[guard] blocked: ...`. To see them, run `docker compose logs | grep guard`.

The guard only exists in the Docker deployment. The local and Cloudflare Worker modes don't have it.

## Self-hosting with Docker

The container runs the same server as the Cloudflare Worker, on Node. It works on any Linux machine with Docker, x86_64 or ARM (an Oracle Cloud Ampere instance, for example).

Compared with the Worker, the container adds:

- the [read-only guard](#read-only-guard)
- a required secret: every request needs it, either in the path (`/<MCP_AUTH_SECRET>/mcp`) or as `Authorization: Bearer <MCP_AUTH_SECRET>`. Anything else gets a `404`. Claude's custom connectors can't send headers, so they need the path form.
- `GET /healthz` for monitoring (no secret needed, returns `ok`)

### 1. Configure

```bash
git clone https://github.com/dussud/moodle-mcp.git
cd moodle-mcp
cp .env.example .env
chmod 600 .env
sed -i "s/^MCP_AUTH_SECRET=.*/MCP_AUTH_SECRET=$(openssl rand -hex 24)/" .env
nano .env   # set MOODLE_TOKEN
```

### 2a. Run behind your own reverse proxy

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/healthz   # -> ok
```

The container only listens on `127.0.0.1:3000`. Put a reverse proxy with TLS in front of it. Caddy handles HTTPS for you:

```
moodle-mcp.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx works too. Turn off buffering (`proxy_buffering off;`) so streamed responses go straight through.

### 2b. Run behind an existing Traefik

If the machine already runs Traefik with a Let's Encrypt resolver, set `MCP_HOST`, `TRAEFIK_NETWORK` (the Docker network Traefik is on) and `TRAEFIK_CERTRESOLVER` in `.env`, then run:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

### 3. DNS and firewall

- Point an `A` record for your domain at the server's public IP. If the domain is on Cloudflare, set the record to DNS only (grey cloud), at least until the certificate is issued. Let's Encrypt's TLS-ALPN challenge doesn't work through Cloudflare's proxy.
- Open ports 80 and 443. On Oracle Cloud you have to open them in two places: the VCN security list or NSG ingress rules, and the instance firewall (`iptables` / `netfilter-persistent`).

### 4. Connect

Your MCP URL is:

```
https://moodle-mcp.example.com/<MCP_AUTH_SECRET>/mcp
```

Print the secret with `grep MCP_AUTH_SECRET .env`. Treat the URL like a password. If it leaks, put a new `openssl rand -hex 24` value in `.env` and run `docker compose up -d`.

- **Claude** (web and desktop): Settings > Connectors > Add custom connector, then paste the URL.
- **Claude Code**: `claude mcp add moodle --transport http https://moodle-mcp.example.com/<MCP_AUTH_SECRET>/mcp`
- **Clients that can send headers**: use `https://moodle-mcp.example.com/mcp` with `Authorization: Bearer <MCP_AUTH_SECRET>`.

To test it from a shell:

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

### Using the prebuilt image

Every push to `master` builds an image for `linux/amd64` and `linux/arm64` and publishes it as `ghcr.io/dussud/moodle-mcp:latest` (see [Publishing your fork on GitHub](#publishing-your-fork-on-github)). To use it, replace `build: .` with `image: ghcr.io/dussud/moodle-mcp:latest` in `docker-compose.yml`, then run `docker compose pull && docker compose up -d`.

### Troubleshooting

| Symptom | Cause |
|---|---|
| `404` on every request | The secret is missing or wrong, in the URL or the `Authorization` header |
| `{"error":"Invalid Moodle token..."}` | The token is wrong or expired, or you pasted `signature:::token`. See [Getting your token](#getting-your-token) |
| `This server only supports UCL Moodle...` | `MOODLE_URL` is set to another site. Remove it |
| `{"error":"fetch failed"}` | The container can't reach `moodle.ucl.ac.uk` (DNS or firewall) |
| `Blocked by read-only guard: ...` | A tool used a function that isn't on the allowed list. See [Read-only guard](#read-only-guard) |
| Traefik returns `404 page not found` for a few seconds after starting | Traefik waits for the container's health check to pass |
| The browser shows a certificate error | DNS doesn't point at the server yet, the record is proxied through Cloudflare, or port 443 is closed |

## Publishing your fork on GitHub

To make your own copy:

1. Fork the repo, on GitHub or with the GitHub CLI:
   ```bash
   gh repo fork dussud/moodle-mcp --clone
   cd moodle-mcp
   ```
2. Push your changes:
   ```bash
   git add -A
   git commit -m "Describe your change"
   git push origin master
   ```
   Never commit `.env`, because it holds your Moodle token. `.gitignore` already excludes it, and only `.env.example` is tracked.
3. The Docker image is built by GitHub Actions ([`.github/workflows/docker.yml`](.github/workflows/docker.yml)), which pushes `ghcr.io/<you>/moodle-mcp` on every push to `master` and on `v*` tags. On a fork, enable it once under Actions ("I understand my workflows, go ahead and enable them"). New packages are private. Either make yours public (Packages > moodle-mcp > Package settings > Change visibility), or log in on the server with a personal access token that has `read:packages`:
   ```bash
   echo "$GHCR_PAT" | docker login ghcr.io -u <your-github-user> --password-stdin
   ```
4. To pull in changes from upstream:
   ```bash
   git remote add upstream https://github.com/1alexandrer/moodle-mcp.git   # once
   git fetch upstream
   git merge upstream/master
   git push origin master
   ```
   You can also click Sync fork on GitHub. After merging, check whether new tools need their functions added to `MOODLE_WS_EXTRA_ALLOWED`. Keep anything that writes to Moodle blocked.

## Contributing

Issues and pull requests are welcome. For big changes, open an issue first. If a change would help every Moodle site, consider sending it to [upstream](https://github.com/1alexandrer/moodle-mcp) instead.

### Publishing the npm package

`npm create ucl-moodle-mcp` runs [`packages/create-ucl-moodle-mcp`](packages/create-ucl-moodle-mcp). It's a small launcher that downloads this repo's `master` branch and runs [`scripts/setup.mjs`](scripts/setup.mjs), so changes to the setup reach users as soon as they're pushed. You only need to republish when the launcher (`index.mjs`) changes:

```bash
cd packages/create-ucl-moodle-mcp
npm version patch
npm publish
```

MIT License. © 2026 Alexandre Ribeiro
