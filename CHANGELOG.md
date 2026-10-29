# Changelog

## [Unreleased]

### Added
- `moodle_get_section` — read one course section in full: the section's own text (timetables, calendars), every label, and activity descriptions
- `moodle_get_page` — read the text of a Page activity (HTML converted to Markdown-ish text); embedded files get `fileId`s for `moodle_download_file`
- `moodle_get_book` — read a Book activity: table of contents plus chapter text, whole book or a single `chapterId`

### Changed
- `moodle_get_course` now shows each module's `moduleId`, each section's `sectionId` with a preview of its text, and label previews instead of truncated names; sections that contain only text are no longer hidden
- `moodle_download_file` extracts text from PDF (unpdf) and DOCX (mammoth) instead of returning an embedded resource Claude clients refuse; images are returned as image content
- `moodle_get_forum_discussions` includes an excerpt of each opening post
- HTML tables (pages, books, DOCX) are rendered as Markdown tables

### Fixed
- `moodle_list_forums` returned course-module IDs; it now returns the forum instance IDs `moodle_get_forum_discussions` expects
- `moodle_get_forum_discussions` sent `sortby`/`sortdirection`, which Moodle rejects as invalid parameters
- `moodle_get_calendar_events` filtered on a field action events don't have, so a `courseId` filter always returned nothing
- `moodle_list_assignments` failed outright when Moodle's `mod_assign_get_assignments` errored for a course ("Invalid response value detected"); it now falls back to due dates from the course contents

## [0.1.0] — 2026-04-15

### Added

**Tools (13 total)**
- `moodle_get_site_info` — school name, Moodle version, enabled API status
- `moodle_list_courses` — all enrolled courses
- `moodle_get_course` — sections and activities
- `moodle_list_resources` — files and links grouped by course section
- `moodle_list_assignments` — assignments with due dates, grouped by section
- `moodle_get_assignment` — submission status and grade feedback
- `moodle_get_grades` — full grade report with category grouping
- `moodle_get_calendar_events` — upcoming events with optional course filter
- `moodle_list_quizzes` — quizzes with time limits and open/close dates
- `moodle_get_quiz_attempts` — past attempt history and grades
- `moodle_list_forums` — forum activities grouped by section
- `moodle_get_forum_discussions` — recent discussions with reply counts
- `moodle_get_notifications` — recent notifications with unread indicator

**MCP Resources**
- Course files exposed as MCP resources at `moodle://courses/{courseId}/files/{encodedUrl}`
- PDFs and text files readable directly by Claude
- Enables AI-powered document synthesis

**MCP Prompts**
- `summarize-course` — structured course summary
- `whats-due` — prioritized upcoming deadlines
- `build-study-notes` — builds a linked Obsidian vault from course materials
- `exam-prep` — study guide based on grades and quiz results
- `search-notes` — natural language search across course files

**Infrastructure**
- Token auth + username/password auth
- Graceful degradation: tools return helpful messages instead of crashing when a school's Moodle doesn't expose an API
- `supports()` helper on `MoodleClient` for capability detection
- Natural section grouping in all listing tools (preserves professor's structure)
