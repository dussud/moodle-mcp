#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { MoodleClient } from "./moodle-client.js";
import { registerAllTools } from "./register-tools.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

if (process.stdin.isTTY && !process.env.MOODLE_TOKEN) {
  console.log(`
moodle-mcp (UCL edition) — MCP server for UCL Moodle (https://moodle.ucl.ac.uk)

This runs as a background server for your AI assistant; you don't run it directly.

Easiest setup (gets your token and deploys your own private server):
  npm create ucl-moodle-mcp

To run it locally instead, point your MCP client at this file with your token:
  "command": "node",
  "args": ["${process.argv[1]?.replace(/\\/g, "/") ?? "dist/server.js"}"],
  "env": { "MOODLE_TOKEN": "your_token_here" }

Full guide: https://github.com/dussud/moodle-mcp#readme
`);
  process.exit(0);
}

async function main() {
  const config = getConfig();
  const client = await MoodleClient.create(config);

  const server = new McpServer({
    name: "moodle-mcp",
    version: "0.2.0",
  });

  registerAllTools(server, client);
  registerResources(server, client);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start moodle-mcp:", err.message);
  process.exit(1);
});
