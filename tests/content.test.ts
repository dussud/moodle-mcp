import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { htmlToText } from "../src/html-to-text.js";
import { getPage, getBook } from "../src/tools/content.js";
import { getCourse } from "../src/tools/courses.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const BASE = "https://moodle.uni.edu";
const wsfile = (path: string) => `${BASE}/webservice/pluginfile.php/${path}`;

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) });
}

function html(body: string) {
  const bytes = new TextEncoder().encode(body);
  return Promise.resolve({
    ok: true,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  });
}

const sections = [
  {
    id: 1,
    name: "Week 1",
    summary: "",
    modules: [
      {
        id: 10,
        name: "Welcome",
        modname: "page",
        url: `${BASE}/mod/page/view.php?id=10`,
        contents: [
          { type: "file", filename: "index.html", filepath: "/", filesize: 0, fileurl: wsfile("5/mod_page/content/1/index.html") },
          { type: "file", filename: "diagram.png", filepath: "/", filesize: 1234, mimetype: "image/png", fileurl: wsfile("5/mod_page/content/1/diagram.png") },
        ],
      },
      {
        id: 20,
        name: "Handbook",
        modname: "book",
        contents: [
          {
            type: "content",
            filename: "structure",
            filepath: "/",
            filesize: 0,
            content: JSON.stringify([
              { title: "Intro", href: "7/index.html", level: 0, hidden: "0", subitems: [
                { title: "Details", href: "9/index.html", level: 1, hidden: "0", subitems: [] },
              ] },
            ]),
          },
          { type: "file", filename: "index.html", filepath: "/7/", filesize: 0, content: "Intro", fileurl: wsfile("6/mod_book/chapter/7/index.html") },
          { type: "file", filename: "index.html", filepath: "/9/", filesize: 0, content: "Details", fileurl: wsfile("6/mod_book/chapter/9/index.html") },
          { type: "file", filename: "notes.pdf", filepath: "/9/", filesize: 99, mimetype: "application/pdf", fileurl: wsfile("6/mod_book/chapter/9/notes.pdf") },
        ],
      },
      { id: 30, name: "Slides", modname: "resource", contents: [] },
    ],
  },
];

async function makeClient() {
  mockFetch.mockResolvedValueOnce(json({ userid: 42, username: "s", sitename: "Uni", fullname: "S", release: "4.3" }));
  return MoodleClient.create({ baseUrl: BASE, token: "tok", maxFileBytes: 1024 * 1024 });
}

describe("htmlToText", () => {
  it("converts common editor markup", () => {
    const out = htmlToText(`<html><head><title>x</title><style>p{}</style></head><body>
      <h2>Title</h2><p>Hello&nbsp;<strong>world</strong> &amp; <em>friends</em>.<br>Line two</p>
      <ul><li>One</li><li><a href="https://ex.com">Two</a></li></ul>
      <p><a href="${BASE}/pluginfile.php/1/x.pdf">File</a> <img src="a.png" alt="Graph"></p>
      <pre>  code &lt;x&gt;
  more</pre></body></html>`);
    expect(out).toContain("## Title");
    expect(out).toContain("Hello **world** & _friends_.\nLine two");
    expect(out).toContain("- One\n- [Two](https://ex.com)");
    expect(out).toContain("File [image: Graph]");
    expect(out).not.toContain("pluginfile");
    expect(out).toContain("```\n  code <x>\n  more\n```");
    expect(out).not.toContain("p{}");
    expect(htmlToText("<pre><div>int a;</div><div>  a++;</div></pre><pre> </pre>")).toBe("```\nint a;\n  a++;\n```");
    expect(htmlToText('<p><iframe src="x" title="Lecture 1"></iframe></p>')).toBe("[embedded content: Lecture 1]");
  });
});

describe("content tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getCourse shows moduleIds", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(json(sections));
    const out = await getCourse(client, 3);
    expect(out).toContain("**Welcome** — moduleId: `10`");
    expect(out).toContain("moodle_get_book");
  });

  it("getPage reads content via mod_page_get_pages_by_courses and seals attachment ids", async () => {
    const client = await makeClient();
    mockFetch
      .mockResolvedValueOnce(json(sections))
      .mockResolvedValueOnce(json({ pages: [{ coursemodule: 10, content: "<p>Welcome to the course</p>" }] }));
    const out = await getPage(client, 3, 10);
    expect(out).toContain("# Welcome");
    expect(out).toContain("Welcome to the course");
    expect(out).toMatch(/diagram\.png\*\* — fileId: `f_/);
    expect(out).not.toContain("pluginfile");
    expect(String(mockFetch.mock.calls[2][1].body)).toContain("wsfunction=mod_page_get_pages_by_courses");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("getPage falls back to pluginfile index.html when the page WS is not enabled", async () => {
    mockFetch.mockResolvedValueOnce(json({
      userid: 42, username: "s", sitename: "Uni", fullname: "S", release: "4.3",
      functions: [{ name: "core_course_get_contents", version: "1" }],
    }));
    const client = await MoodleClient.create({ baseUrl: BASE, token: "tok", maxFileBytes: 1024 * 1024 });
    mockFetch.mockResolvedValueOnce(json(sections)).mockResolvedValueOnce(html("<body><p>From pluginfile</p></body>"));
    const out = await getPage(client, 3, 10);
    expect(out).toContain("From pluginfile");
    // Token goes on the outbound request only.
    expect(String(mockFetch.mock.calls[2][0])).toContain("/mod_page/content/1/index.html");
    expect(String(mockFetch.mock.calls[2][0])).toContain("token=tok");
  });

  it("getPage rejects non-page modules with a hint", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(json(sections));
    expect(await getPage(client, 3, 20)).toContain("Use moodle_get_book instead");
    mockFetch.mockResolvedValueOnce(json(sections));
    expect(await getPage(client, 3, 999)).toContain("not found");
  });

  it("getBook returns TOC and all chapters in order", async () => {
    const client = await makeClient();
    mockFetch
      .mockResolvedValueOnce(json(sections))
      .mockResolvedValueOnce(html("<body><h3>Intro</h3><p>First chapter</p></body>"))
      .mockResolvedValueOnce(html("<body><h3>Details</h3><p>Second chapter</p></body>"));
    const out = await getBook(client, 3, 20);
    expect(out).toContain("- Intro — chapterId: `7`\n  - Details — chapterId: `9`");
    expect(out.indexOf("First chapter")).toBeLessThan(out.indexOf("Second chapter"));
    expect(out).not.toContain("### Intro");
    expect(out).toMatch(/notes\.pdf\*\* — fileId: `f_/);
  });

  it("getBook can return a single chapter", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(json(sections)).mockResolvedValueOnce(html("<p>Only intro</p>"));
    const out = await getBook(client, 3, 20, 7);
    expect(out).toContain("Only intro");
    expect(out).not.toContain("notes.pdf");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(String(mockFetch.mock.calls[2][0])).toContain("/mod_book/chapter/7/index.html");
  });

  it("getBook keeps the TOC and explains when chapter HTML is blocked by a WAF", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(json(sections)).mockResolvedValueOnce(Promise.resolve({
      ok: false,
      status: 403,
      headers: new Headers({ "cf-mitigated": "challenge", "content-type": "text/html" }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    const out = await getBook(client, 3, 20);
    expect(out).toContain("- Intro — chapterId: `7`");
    expect(out).toContain("Cloudflare bot protection");
    // Stops after the first blocked chapter instead of hammering the rest.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe("htmlToText tables", () => {
  it("renders tables as Markdown with multi-paragraph cells flattened", () => {
    const out = htmlToText(
      "<table><tr><td></td><td><p>Fail</p></td></tr><tr><td>Tech</td><td><p>Does not work</p><p>At all | ever</p></td></tr></table>",
    );
    expect(out).toBe("|  | Fail |\n| --- | --- |\n| Tech | Does not work / At all \\| ever |");
  });
});
