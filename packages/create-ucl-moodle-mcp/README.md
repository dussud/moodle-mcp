# create-ucl-moodle-mcp

Connect Claude or ChatGPT to your **UCL Moodle** (`moodle.ucl.ac.uk`) in one command:

```bash
npm create ucl-moodle-mcp
```

You need [Node.js 18+](https://nodejs.org), a free [Cloudflare account](https://dash.cloudflare.com/sign-up/workers-and-pages), and to be logged in to UCL Moodle in your default browser.

It downloads [dussud/moodle-mcp](https://github.com/dussud/moodle-mcp), gets your Moodle token from your browser session, deploys your own private MCP server on Cloudflare Workers, and prints its URL with instructions for Claude and ChatGPT.

The URL is personal: it gives read access to your Moodle account, so don't share it. Run the command again any time to get a new token or URL.

Full documentation: https://github.com/dussud/moodle-mcp#readme
