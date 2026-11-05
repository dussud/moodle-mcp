import { describe, expect, it } from "vitest";
import worker from "../src/worker.js";

// MOODLE_TOKEN is deliberately missing: a request that gets past auth answers 500
// ("Set MOODLE_URL and MOODLE_TOKEN...") without touching the network.
const SECRET = "a".repeat(64);
const env = { MOODLE_URL: "https://moodle.example.edu", MOODLE_TOKEN: "", MCP_AUTH_SECRET: SECRET };

const post = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://w.example.workers.dev${path}`, { method: "POST", headers }), env);

describe("worker MCP_AUTH_SECRET", () => {
  it("rejects requests without the secret", async () => {
    expect((await post("/mcp")).status).toBe(404);
    expect((await post("/")).status).toBe(404);
    expect((await post(`/${SECRET.slice(1)}/mcp`)).status).toBe(404);
    expect((await post("/mcp", { Authorization: "Bearer wrong" })).status).toBe(404);
  });

  it("accepts the secret as first path segment or bearer token", async () => {
    expect((await post(`/${SECRET}/mcp`)).status).toBe(500);
    expect((await post("/mcp", { Authorization: `Bearer ${SECRET}` })).status).toBe(500);
  });

  it("stays open when no secret is configured (backwards compatible)", async () => {
    const res = await worker.fetch(new Request("https://w.example.workers.dev/mcp", { method: "POST" }), {
      ...env,
      MCP_AUTH_SECRET: undefined,
    });
    expect(res.status).toBe(500);
  });
});
