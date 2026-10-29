import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { htmlToText } from "../html-to-text.js";

interface CourseSection {
  id: number;
  name: string;
  modules: { id: number; instance: number; name: string; modname: string; url?: string }[];
}

interface Discussion {
  id: number;
  discussion: number;
  name: string;
  userfullname?: string;
  firstuserfullname?: string;
  message?: string;
  numreplies: number;
  timemodified: number;
  pinned: boolean;
}

interface DiscussionsResponse {
  discussions: Discussion[];
}

const MAX_EXCERPT = 600;

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-CA", { dateStyle: "medium" });
}

export async function listForums(client: MoodleClient, courseId: number): Promise<string> {
  const sections = await client.call<CourseSection[]>("core_course_get_contents", {
    courseid: courseId,
  });

  const lines: string[] = [`## Forums — Course ${courseId}\n`];
  let hasAny = false;

  for (const section of sections) {
    const forumMods = section.modules.filter((m) => m.modname === "forum");
    if (forumMods.length === 0) continue;

    lines.push(`### ${section.name || "General"}`);
    hasAny = true;

    for (const mod of forumMods) {
      // mod.id is the course-module id; the forum API wants the forum instance id.
      lines.push(`- **${mod.name}** — ID: \`${mod.instance}\` (use with moodle_get_forum_discussions)`);
      if (mod.url) lines.push(`  [Open](${mod.url})`);
    }
    lines.push("");
  }

  if (!hasAny) return "No forums found in this course.";
  return lines.join("\n");
}

export async function getForumDiscussions(client: MoodleClient, forumId: number): Promise<string> {
  if (!client.supports("mod_forum_get_forum_discussions")) {
    return "Forum discussions API is not enabled on your Moodle. Ask your admin to enable mod_forum web services.";
  }

  const data = await client.call<DiscussionsResponse>("mod_forum_get_forum_discussions", {
    // Default sort order is most recent post first.
    forumid: forumId,
    page: 0,
    perpage: 20,
  });

  const discussions = data.discussions ?? [];
  if (discussions.length === 0) return `No discussions found in forum ${forumId}.`;

  const lines: string[] = [`## Forum ${forumId} — Recent Discussions\n`];

  for (const d of discussions) {
    const pinned = d.pinned ? " 📌" : "";
    lines.push(`- **${d.name}**${pinned}`);
    const author = d.userfullname ?? d.firstuserfullname ?? "Unknown";
    lines.push(`  By ${author} | ${d.numreplies} replies | Last activity: ${formatDate(d.timemodified)}`);
    const text = htmlToText(d.message ?? "").replace(/\s+/g, " ").trim();
    if (text) lines.push(`  > ${text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT)}…` : text}`);
  }

  return lines.join("\n");
}

export function registerForumTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_list_forums",
    "List all forum activities in a course, grouped by section. Returns forum IDs for use with moodle_get_forum_discussions.",
    { courseId: z.number().describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => ({
      content: [{ type: "text" as const, text: await listForums(client, courseId) }],
    })
  );

  server.tool(
    "moodle_get_forum_discussions",
    "Get recent discussions in a forum — title, author, reply count, last activity date, and an excerpt of the opening post.",
    { forumId: z.number().describe("Forum ID from moodle_list_forums") },
    async ({ forumId }) => ({
      content: [{ type: "text" as const, text: await getForumDiscussions(client, forumId) }],
    })
  );
}
