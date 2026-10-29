import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { htmlToText } from "../html-to-text.js";

interface Course {
  id: number;
  fullname: string;
  shortname: string;
  startdate: number;
  enddate: number;
  summary: string;
}

interface CourseModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  description?: string;
}

interface CourseSection {
  id: number;
  name: string;
  summary: string;
  modules: CourseModule[];
}

export async function listCourses(client: MoodleClient): Promise<string> {
  const courses = await client.call<Course[]>("core_enrol_get_users_courses", {
    userid: client.userId,
  });
  if (courses.length === 0) return "You are not enrolled in any courses.";
  const lines = courses.map(
    (c) => `- **${c.fullname}** (${c.shortname}) — ID: \`${c.id}\``
  );
  return `## Your Courses\n\n${lines.join("\n")}`;
}

const PREVIEW_CHARS = 160;
// A whole section (labels included) can be long; keep one response bounded.
const MAX_SECTION_CHARS = 100_000;

function preview(html: string | undefined): string {
  // Previews are one line: drop heading markers and decorative images.
  const text = htmlToText(html ?? "")
    .replace(/\[image(: [^\]]*)?\]/g, "")
    .replace(/^#{1,6} /gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

export async function getCourse(client: MoodleClient, courseId: number): Promise<string> {
  const sections = await client.call<CourseSection[]>("core_course_get_contents", {
    courseid: courseId,
  });
  const lines: string[] = [];
  for (const section of sections) {
    const summary = preview(section.summary);
    // Sections with only summary text (timetables, calendars) still matter.
    if (section.modules.length === 0 && !summary) continue;
    lines.push(`### ${section.name || "General"} — sectionId: \`${section.id}\``);
    if (summary) lines.push(`> ${summary}`);
    for (const mod of section.modules) {
      if (mod.modname === "label") {
        lines.push(`- \`label\` ${preview(mod.description) || mod.name}`);
        continue;
      }
      const link = mod.url ? ` — [open](${mod.url})` : "";
      lines.push(`- \`${mod.modname}\` **${mod.name}** — moduleId: \`${mod.id}\`${link}`);
    }
  }
  if (lines.length === 0) return "This course has no content.";
  lines.push(
    "",
    "_Section text and labels are previews: read a section in full with moodle_get_section (courseId + sectionId). " +
      "Read `page` modules with moodle_get_page and `book` modules with moodle_get_book (courseId + moduleId)._",
  );
  return lines.join("\n");
}

export async function getSection(client: MoodleClient, courseId: number, sectionId: number): Promise<string> {
  const sections = await client.call<CourseSection[]>("core_course_get_contents", {
    courseid: courseId,
  });
  const section = sections.find((s) => s.id === sectionId);
  if (!section) {
    return `Section ${sectionId} was not found in course ${courseId} (or is hidden from you). Use moodle_get_course to list section IDs.`;
  }

  const lines: string[] = [`# ${section.name || "General"}`, ""];
  const summary = htmlToText(section.summary ?? "");
  if (summary) lines.push(summary, "");

  for (const mod of section.modules) {
    const text = htmlToText(mod.description ?? "");
    if (mod.modname === "label") {
      if (text) lines.push(text, "");
      continue;
    }
    const link = mod.url ? ` — [open](${mod.url})` : "";
    lines.push(`- \`${mod.modname}\` **${mod.name}** — moduleId: \`${mod.id}\`${link}`);
    if (text) lines.push("", text.replace(/^/gm, "  "));
    lines.push("");
  }

  let out = lines.join("\n").trim();
  if (out.length > MAX_SECTION_CHARS) {
    out = `${out.slice(0, MAX_SECTION_CHARS)}\n\n_[Truncated: section is ${out.length.toLocaleString("en")} characters.]_`;
  }
  return out;
}

export function registerCourseTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_list_courses",
    "List all Moodle courses you are enrolled in",
    {},
    async () => ({ content: [{ type: "text" as const, text: await listCourses(client) }] })
  );

  server.tool(
    "moodle_get_course",
    "Get the outline of a course: each section (with sectionId and a preview of its text) and its activities and labels (with moduleId). Use moodle_list_courses first to get course IDs.",
    { courseId: z.number().describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => ({
      content: [{ type: "text" as const, text: await getCourse(client, courseId) }],
    })
  );

  server.tool(
    "moodle_get_section",
    "Read one course section in full: the section's own text (often timetables, calendars, weekly instructions), the full text of every label, and each activity with its description. Get sectionId from moodle_get_course.",
    {
      courseId: z.number().describe("Course ID from moodle_list_courses"),
      sectionId: z.number().describe("Section ID from moodle_get_course"),
    },
    async ({ courseId, sectionId }) => ({
      content: [{ type: "text" as const, text: await getSection(client, courseId, sectionId) }],
    })
  );
}
