/** This fork only talks to UCL Moodle. */
export const UCL_MOODLE_URL = "https://moodle.ucl.ac.uk";

export interface Config {
  baseUrl: string;
  token: string;
  /** Per-file download cap in bytes. Default 25 MB. */
  maxFileBytes: number;
}

export const DEFAULT_MAX_FILE_MB = 25;

export function parseMaxFileMb(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_MAX_FILE_MB;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `MOODLE_MCP_MAX_FILE_MB must be a positive number; got "${raw}"`,
    );
  }
  return n;
}

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    throw new Error(`Invalid MOODLE_URL: "${raw}" is not a valid URL`);
  }
}

/**
 * MOODLE_URL is optional and defaults to UCL Moodle. Any other site is refused:
 * this fork is UCL-only (use upstream 1alexandrer/moodle-mcp for other schools).
 */
export function resolveMoodleUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") return UCL_MOODLE_URL;
  const origin = normalizeUrl(raw.trim());
  if (origin !== UCL_MOODLE_URL) {
    throw new Error(
      `This server only supports UCL Moodle (${UCL_MOODLE_URL}), but MOODLE_URL is "${raw}". ` +
        "Remove MOODLE_URL, or use https://github.com/1alexandrer/moodle-mcp for other Moodle sites.",
    );
  }
  return origin;
}

export function getConfig(): Config {
  const baseUrl = resolveMoodleUrl(process.env.MOODLE_URL);
  const token = process.env.MOODLE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "MOODLE_TOKEN environment variable is required. Get one with `npm create ucl-moodle-mcp` " +
        "or see README > Getting your token.",
    );
  }

  const maxFileBytes = Math.floor(parseMaxFileMb(process.env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024);

  return { baseUrl, token, maxFileBytes };
}
