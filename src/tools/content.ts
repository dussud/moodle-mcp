import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { htmlToText } from "../html-to-text.js";

interface ModuleContent {
  type: string;
  filename: string;
  filepath?: string;
  fileurl?: string;
  filesize: number;
  mimetype?: string;
  content?: string;
}

interface CourseModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  contents?: ModuleContent[];
}

interface CourseSection {
  name: string;
  modules: CourseModule[];
}

interface BookTocItem {
  title: string;
  href: string;
  level: number;
  hidden?: string | number;
  subitems?: BookTocItem[];
}

interface Chapter {
  id: number;
  title: string;
  level: number;
  file: ModuleContent;
}

interface PagesResponse {
  pages?: { coursemodule: number; content?: string }[];
}

// Keeps a whole-book response within a reasonable context budget; callers can
// fetch individual chapters for anything past the cut.
const MAX_BOOK_CHARS = 100_000;

async function findModule(
  client: MoodleClient,
  courseId: number,
  moduleId: number,
): Promise<CourseModule | null> {
  const sections = await client.call<CourseSection[]>("core_course_get_contents", {
    courseid: courseId,
  });
  for (const section of sections) {
    for (const mod of section.modules) {
      if (mod.id === moduleId) return mod;
    }
  }
  return null;
}

function wrongModule(mod: CourseModule | null, expected: string, moduleId: number): string {
  if (!mod) {
    return `Module ${moduleId} was not found in this course (or is hidden from you). Use moodle_get_course to list module IDs.`;
  }
  const hint =
    mod.modname === "page"
      ? " Use moodle_get_page instead."
      : mod.modname === "book"
        ? " Use moodle_get_book instead."
        : ["resource", "folder", "url"].includes(mod.modname)
          ? " Use moodle_list_resources and moodle_download_file instead."
          : "";
  return `Module ${moduleId} (**${mod.name}**) is a \`${mod.modname}\`, not a ${expected}.${hint}`;
}

async function fetchHtml(client: MoodleClient, file: ModuleContent): Promise<string> {
  if (!file.fileurl) return "";
  const { bytes } = await client.downloadFile(file.fileurl);
  return htmlToText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}

/** Seal fileIds for embedded files (images, PDFs) so moodle_download_file can open them. */
async function listAttachments(
  client: MoodleClient,
  courseId: number,
  files: ModuleContent[],
): Promise<string[]> {
  const lines: string[] = [];
  for (const file of files) {
    if (!file.fileurl) continue;
    const fileId = await client.fileIdStore.seal({
      userId: client.userId,
      courseId,
      fileurl: file.fileurl,
      mime: file.mimetype ?? "application/octet-stream",
      filename: file.filename,
      filesize: file.filesize,
    });
    lines.push(`- 📄 **${file.filename}** — fileId: \`${fileId}\``);
  }
  return lines;
}

function isIndex(file: ModuleContent): boolean {
  return file.type === "file" && file.filename === "index.html";
}

/**
 * Page HTML straight from the WS API. Preferred over pluginfile's generated
 * index.html, which some sites' WAFs (e.g. Cloudflare bot challenges) block.
 */
async function fetchPageViaApi(
  client: MoodleClient,
  courseId: number,
  moduleId: number,
): Promise<string | null> {
  if (!client.supports("mod_page_get_pages_by_courses")) return null;
  const data = await client.call<PagesResponse>("mod_page_get_pages_by_courses", {
    "courseids[0]": courseId,
  });
  const page = data.pages?.find((p) => p.coursemodule === moduleId);
  return page ? htmlToText(page.content ?? "") : null;
}

export async function getPage(client: MoodleClient, courseId: number, moduleId: number): Promise<string> {
  const mod = await findModule(client, courseId, moduleId);
  if (!mod || mod.modname !== "page") return wrongModule(mod, "page", moduleId);

  const contents = mod.contents ?? [];
  const index = contents.find((f) => isIndex(f) && (f.filepath ?? "/") === "/");

  let text = await fetchPageViaApi(client, courseId, moduleId);
  if (text === null) {
    if (!index) return `Page **${mod.name}** has no readable content.`;
    text = await fetchHtml(client, index);
  }
  const lines = [`# ${mod.name}`, "", text || "_(empty page)_"];

  const attachments = await listAttachments(
    client,
    courseId,
    contents.filter((f) => f.type === "file" && f !== index),
  );
  if (attachments.length) {
    lines.push("", "## Embedded files", "", ...attachments, "", "_Call `moodle_download_file` with a fileId to open it._");
  }
  return lines.join("\n");
}

function chapterIdFromPath(filepath: string | undefined): number | null {
  const m = filepath?.match(/^\/(\d+)\/$/);
  return m ? Number(m[1]) : null;
}

/** Ordered chapter list, using the book's TOC for titles/levels when available. */
function getChapters(contents: ModuleContent[]): Chapter[] {
  const indexById = new Map<number, ModuleContent>();
  for (const f of contents) {
    const id = isIndex(f) ? chapterIdFromPath(f.filepath) : null;
    if (id !== null) indexById.set(id, f);
  }

  const structure = contents.find((f) => f.type === "content" && f.filename === "structure");
  let toc: BookTocItem[] = [];
  try {
    toc = structure?.content ? (JSON.parse(structure.content) as BookTocItem[]) : [];
  } catch {
    toc = [];
  }

  const chapters: Chapter[] = [];
  const walk = (items: BookTocItem[]) => {
    for (const item of items) {
      const id = Number(item.href.split("/")[0]);
      const file = indexById.get(id);
      if (file && !chapters.some((c) => c.id === id)) {
        chapters.push({ id, title: item.title, level: item.level ?? 0, file });
      }
      walk(item.subitems ?? []);
    }
  };
  walk(toc);

  // Chapters missing from the TOC (or no TOC at all): fall back to export order.
  for (const [id, file] of indexById) {
    if (!chapters.some((c) => c.id === id)) {
      chapters.push({ id, title: file.content || `Chapter ${id}`, level: 0, file });
    }
  }
  return chapters;
}

export async function getBook(
  client: MoodleClient,
  courseId: number,
  moduleId: number,
  chapterId?: number,
): Promise<string> {
  const mod = await findModule(client, courseId, moduleId);
  if (!mod || mod.modname !== "book") return wrongModule(mod, "book", moduleId);

  const contents = mod.contents ?? [];
  const chapters = getChapters(contents);
  if (chapters.length === 0) return `Book **${mod.name}** has no chapters visible to you.`;

  const toc = chapters.map(
    (c) => `${"  ".repeat(c.level)}- ${c.title} — chapterId: \`${c.id}\``,
  );

  let selected = chapters;
  if (chapterId !== undefined) {
    selected = chapters.filter((c) => c.id === chapterId);
    if (selected.length === 0) {
      return [`Chapter ${chapterId} not found in **${mod.name}**. Chapters:`, "", ...toc].join("\n");
    }
  }

  const lines = [`# ${mod.name}`, ""];
  if (chapterId === undefined) lines.push("## Contents", "", ...toc, "");

  let used = 0;
  const skipped: Chapter[] = [];
  for (const chapter of selected) {
    if (used >= MAX_BOOK_CHARS) {
      skipped.push(chapter);
      continue;
    }
    let text: string;
    try {
      text = await fetchHtml(client, chapter.file);
    } catch (err) {
      // Chapter HTML only exists behind pluginfile.php (no WS returns it); if the
      // site blocks that, the rest will fail the same way, so stop here.
      lines.push(
        `_Could not load chapter text: ${errorText(err)}_`,
        "",
        `_The table of contents above is still accurate; open the book in Moodle to read it: ${mod.url ?? "(no link)"}_`,
      );
      return lines.join("\n").trim();
    }
    // Moodle prepends the chapter title as a heading; drop it to avoid duplication.
    const body = text.replace(/^#{1,6} .*\n*/, "").trim();
    lines.push(`## ${chapter.title}`, "", body || "_(empty chapter)_", "");
    used += body.length;
  }
  if (skipped.length) {
    lines.push(
      `_Stopped after ~${MAX_BOOK_CHARS.toLocaleString("en")} characters; ${skipped.length} chapter(s) not shown. ` +
        "Call moodle_get_book again with a `chapterId` to read them._",
      "",
    );
  }

  const shownIds = new Set(selected.filter((c) => !skipped.includes(c)).map((c) => c.id));
  const attachments = await listAttachments(
    client,
    courseId,
    contents.filter((f) => {
      if (f.type !== "file" || isIndex(f)) return false;
      const id = chapterIdFromPath(f.filepath);
      return id === null || shownIds.has(id);
    }),
  );
  if (attachments.length) {
    lines.push("## Embedded files", "", ...attachments, "", "_Call `moodle_download_file` with a fileId to open it._");
  }
  return lines.join("\n").trim();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export function registerContentTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_get_page",
    "Read the text of a Moodle Page activity (modname `page`). Get the moduleId from moodle_get_course. Embedded files are listed with fileIds for moodle_download_file.",
    {
      courseId: z.number().describe("Course ID from moodle_list_courses"),
      moduleId: z.number().describe("Module ID of the page, from moodle_get_course"),
    },
    async ({ courseId, moduleId }) => {
      try {
        return { content: [{ type: "text" as const, text: await getPage(client, courseId, moduleId) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: `Could not read page: ${errorText(err)}` }] };
      }
    },
  );

  server.tool(
    "moodle_get_book",
    "Read a Moodle Book activity (modname `book`): table of contents plus chapter text. Without chapterId returns the whole book (truncated if very long); pass a chapterId from the table of contents to read one chapter. Get the moduleId from moodle_get_course.",
    {
      courseId: z.number().describe("Course ID from moodle_list_courses"),
      moduleId: z.number().describe("Module ID of the book, from moodle_get_course"),
      chapterId: z.number().optional().describe("Optional chapter ID from the book's table of contents"),
    },
    async ({ courseId, moduleId, chapterId }) => {
      try {
        return {
          content: [{ type: "text" as const, text: await getBook(client, courseId, moduleId, chapterId) }],
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: `Could not read book: ${errorText(err)}` }] };
      }
    },
  );
}
