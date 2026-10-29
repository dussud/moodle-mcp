import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { listAssignments } from "../src/tools/assignments.js";
import { getCalendarEvents } from "../src/tools/calendar.js";
import { listForums, getForumDiscussions } from "../src/tools/forums.js";
import { extractableKind } from "../src/extract-text.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) });
}

async function makeClient() {
  mockFetch.mockResolvedValueOnce(json({ userid: 42, username: "s", sitename: "Uni", fullname: "S", release: "4.5" }));
  return MoodleClient.create({ baseUrl: "https://moodle.uni.edu", token: "tok", maxFileBytes: 1024 * 1024 });
}

const wsfunction = (call: number) => new URLSearchParams(String(mockFetch.mock.calls[call][1].body));

describe("connector fixes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listAssignments falls back to course contents when mod_assign_get_assignments fails", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation((_url, init) => {
      const fn = new URLSearchParams(String(init.body)).get("wsfunction");
      if (fn === "mod_assign_get_assignments") {
        return json({ exception: "invalid_response_exception", errorcode: "invalidresponse", message: "Invalid response value detected" });
      }
      return json([{ id: 1, name: "Week 1", modules: [
        { id: 900, instance: 77, name: "Final Report", modname: "assign", dates: [{ label: "Due:", timestamp: 1797602400, dataid: "duedate" }] },
      ] }]);
    });
    const out = await listAssignments(client, 5);
    expect(out).toContain("**Final Report** — Due:");
    expect(out).toContain("ID: `77`");
    mockFetch.mockReset();
  });

  it("getCalendarEvents filters on the nested course id", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(json({ events: [
      { id: 1, name: "Report due", timestart: 1797602400, timeduration: 0, eventtype: "due", course: { id: 5, shortname: "A", fullname: "Course A" } },
      { id: 2, name: "Other", timestart: 1797602400, timeduration: 0, eventtype: "due", course: { id: 6, shortname: "B", fullname: "Course B" } },
    ] }));
    const out = await getCalendarEvents(client, 5);
    expect(out).toContain("Report due");
    expect(out).not.toContain("Other");
  });

  it("listForums returns forum instance ids, which getForumDiscussions accepts", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(json([{ id: 1, name: "Week 1", modules: [
      { id: 9105514, instance: 332671, name: "Team forum", modname: "forum" },
    ] }]));
    expect(await listForums(client, 5)).toContain("ID: `332671`");

    mockFetch.mockResolvedValueOnce(json({ discussions: [
      { id: 1, discussion: 1, name: "Brief", userfullname: "Dr X", numreplies: 0, timemodified: 1793035863, pinned: false, message: "<p>Read the <strong>brief</strong>.</p>" },
    ] }));
    const out = await getForumDiscussions(client, 332671);
    expect(out).toContain("By Dr X");
    expect(out).toContain("> Read the **brief**.");
    const params = wsfunction(2);
    expect(params.get("forumid")).toBe("332671");
    expect(params.has("sortby")).toBe(false);
  });

  it("extractableKind detects PDF/DOCX by MIME or extension", () => {
    expect(extractableKind("application/pdf", "x.bin")).toBe("pdf");
    expect(extractableKind("application/octet-stream", "Rubric.DOCX")).toBe("docx");
    expect(extractableKind("image/png", "a.png")).toBeNull();
  });
});
