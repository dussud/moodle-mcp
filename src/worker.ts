import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { parseMaxFileMb, resolveMoodleUrl } from "./config.js";
import { MoodleClient } from "./moodle-client.js";
import { registerAllTools } from "./register-tools.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

interface Env {
  /** Optional; defaults to UCL Moodle, and any other site is refused. */
  MOODLE_URL?: string;
  MOODLE_TOKEN: string;
  MOODLE_MCP_MAX_FILE_MB?: string;
  /** Optional. When set, requests must use path /<secret>/... or "Authorization: Bearer <secret>". */
  MCP_AUTH_SECRET?: string;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request: Request, secret: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ") && safeEqual(auth.slice(7), secret)) return true;
  const first = new URL(request.url).pathname.split("/").filter(Boolean)[0] ?? "";
  return safeEqual(first, secret);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.MCP_AUTH_SECRET && !authorized(request, env.MCP_AUTH_SECRET)) {
      return new Response("Not found", { status: 404 });
    }

    if (!env.MOODLE_TOKEN) {
      return new Response(
        JSON.stringify({
          error: "Set MOODLE_TOKEN as a secret in your Cloudflare Worker (npm create ucl-moodle-mcp does it for you)",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const maxFileBytes = Math.floor(parseMaxFileMb(env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024);
      const config = {
        baseUrl: resolveMoodleUrl(env.MOODLE_URL),
        token: env.MOODLE_TOKEN,
        maxFileBytes,
      };
      const client = await MoodleClient.create(config);

      const server = new McpServer({ name: "moodle-mcp", version: "0.2.0" });

      registerAllTools(server, client);
      registerResources(server, client);
      registerPrompts(server);

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      return transport.handleRequest(request);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
