import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";

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

export async function getCourse(client: MoodleClient, courseId: number): Promise<string> {
  const sections = await client.call<CourseSection[]>("core_course_get_contents", {
    courseid: courseId,
  });
  if (sections.length === 0) return "This course has no content.";
  const lines: string[] = [];
  for (const section of sections) {
    if (section.modules.length === 0) continue;
    lines.push(`### ${section.name || "General"}`);
    for (const mod of section.modules) {
      const link = mod.url ? ` — [open](${mod.url})` : "";
      lines.push(`- \`${mod.modname}\` **${mod.name}** — moduleId: \`${mod.id}\`${link}`);
    }
  }
  if (lines.length === 0) return "This course has no content.";
  lines.push(
    "",
    "_Read `page` modules with moodle_get_page and `book` modules with moodle_get_book (courseId + moduleId)._",
  );
  return lines.join("\n");
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
    "Get the sections and modules of a specific course, with each module's moduleId. Use moodle_list_courses first to get course IDs.",
    { courseId: z.number().describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => ({
      content: [{ type: "text" as const, text: await getCourse(client, courseId) }],
    })
  );
}
