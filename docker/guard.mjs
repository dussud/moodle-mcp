// Outbound request guard: wraps global fetch so the MCP server can only make
// read-only calls to Moodle. Lives outside app/ so upstream updates cannot remove it.
//
// MOODLE_ALLOW_WRITES=true      disables the guard entirely (not recommended)
// MOODLE_WS_EXTRA_ALLOWED=a,b   extra read-only WS functions to allow (e.g. after an upstream update)

const READ_ONLY_FUNCTIONS = new Set([
  "core_webservice_get_site_info",
  "core_enrol_get_users_courses",
  "core_course_get_contents",
  "core_calendar_get_action_events_by_timesort",
  "gradereport_user_get_grade_items",
  "message_popup_get_popup_notifications",
  "mod_assign_get_assignments",
  "mod_assign_get_submission_status",
  "mod_forum_get_forum_discussions",
  "mod_quiz_get_quizzes_by_courses",
  "mod_quiz_get_user_attempts",
]);

const allowWrites = /^(1|true|yes)$/i.test(process.env.MOODLE_ALLOW_WRITES ?? "");

if (allowWrites) {
  console.warn("[guard] MOODLE_ALLOW_WRITES is set: outbound request guard DISABLED");
} else {
  for (const fn of (process.env.MOODLE_WS_EXTRA_ALLOWED ?? "").split(",")) {
    if (fn.trim()) READ_ONLY_FUNCTIONS.add(fn.trim());
  }
  if (!process.env.MOODLE_URL) {
    console.error("MOODLE_URL must be set");
    process.exit(1);
  }
  const moodleHost = new URL(process.env.MOODLE_URL).host;
  const realFetch = globalThis.fetch;

  const refuse = (why) => {
    console.warn(`[guard] blocked: ${why}`);
    throw new Error(`Blocked by read-only guard: ${why}`);
  };

  globalThis.fetch = async (input, init = {}) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (init.method ?? req?.method ?? "GET").toUpperCase();

    if (url.host !== moodleHost) refuse(`non-Moodle host ${url.host}`);

    const path = url.pathname;
    if (path.endsWith("/webservice/rest/server.php")) {
      if (method !== "POST" && method !== "GET") refuse(`${method} to REST API`);
      const body = init.body ?? (req ? await req.clone().text() : undefined);
      const params = new URLSearchParams(body instanceof URLSearchParams ? body : String(body ?? ""));
      const fn = params.get("wsfunction") ?? url.searchParams.get("wsfunction");
      if (!fn || !READ_ONLY_FUNCTIONS.has(fn)) refuse(`WS function "${fn}" is not on the read-only allowlist`);
    } else if (path.endsWith("/pluginfile.php") || path.includes("/pluginfile.php/")) {
      if (method !== "GET" && method !== "HEAD") refuse(`${method} to pluginfile.php`);
    } else {
      refuse(`path ${path} (uploads, logins and other endpoints are not allowed)`);
    }
    return realFetch(input, init);
  };
  console.log(`[guard] read-only mode: ${READ_ONLY_FUNCTIONS.size} WS functions allowed, uploads blocked`);
}
