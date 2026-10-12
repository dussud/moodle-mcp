// Node HTTP wrapper around the moodle-mcp Cloudflare Worker handler.
// Auth: requests must use path /<MCP_AUTH_SECRET>/mcp, or send "Authorization: Bearer <MCP_AUTH_SECRET>".
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import "./guard.mjs";
import worker from "./dist/worker.js";

const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.MCP_AUTH_SECRET;
if (!SECRET || SECRET.length < 24) {
  console.error("MCP_AUTH_SECRET must be set (>= 24 chars)");
  process.exit(1);
}
const env = {
  MOODLE_URL: process.env.MOODLE_URL,
  MOODLE_TOKEN: process.env.MOODLE_TOKEN,
  MOODLE_MCP_MAX_FILE_MB: process.env.MOODLE_MCP_MAX_FILE_MB,
};

const eq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function authorized(req, url) {
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ") && eq(auth.slice(7), SECRET)) return true;
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length >= 1 && eq(parts[0], SECRET);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/healthz") { res.writeHead(200).end("ok"); return; }
  if (!authorized(req, url)) { res.writeHead(404).end(); return; }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined && k !== "authorization") headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) res.write(chunk);
    }
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
}).listen(PORT, () => console.log(`moodle-mcp listening on :${PORT}`));
