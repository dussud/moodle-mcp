import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { normalizeUrl, getConfig, resolveMoodleUrl, UCL_MOODLE_URL } from "../src/config.js";

describe("normalizeUrl", () => {
  it("returns the origin of a base URL", () => {
    expect(normalizeUrl("https://moodle.uni.edu")).toBe("https://moodle.uni.edu");
  });

  it("strips trailing slash", () => {
    expect(normalizeUrl("https://moodle.uni.edu/")).toBe("https://moodle.uni.edu");
  });

  it("strips path from a full course URL", () => {
    expect(normalizeUrl("https://moodle.uni.edu/course/view.php?id=5")).toBe("https://moodle.uni.edu");
  });

  it("strips path and query params", () => {
    expect(normalizeUrl("https://moodle.uni.edu/mod/assign/view.php?id=99")).toBe("https://moodle.uni.edu");
  });

  it("throws on invalid URL", () => {
    expect(() => normalizeUrl("not-a-url")).toThrow("Invalid MOODLE_URL");
  });
});

describe("getConfig", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("defaults to UCL Moodle when MOODLE_URL is not set", () => {
    delete process.env.MOODLE_URL;
    process.env.MOODLE_TOKEN = "abc123";
    const config = getConfig();
    expect(config.baseUrl).toBe(UCL_MOODLE_URL);
    expect(config.token).toBe("abc123");
  });

  it("accepts the UCL URL, even with a path", () => {
    process.env.MOODLE_URL = "https://moodle.ucl.ac.uk/course/view.php?id=5";
    process.env.MOODLE_TOKEN = "abc123";
    expect(getConfig().baseUrl).toBe("https://moodle.ucl.ac.uk");
  });

  it("refuses any other Moodle site", () => {
    process.env.MOODLE_URL = "https://moodle.uni.edu";
    process.env.MOODLE_TOKEN = "abc123";
    expect(() => getConfig()).toThrow("only supports UCL Moodle");
  });

  it("throws when MOODLE_TOKEN is missing", () => {
    delete process.env.MOODLE_URL;
    delete process.env.MOODLE_TOKEN;
    expect(() => getConfig()).toThrow("MOODLE_TOKEN");
  });
});

describe("resolveMoodleUrl", () => {
  it("defaults to UCL for undefined or empty values", () => {
    expect(resolveMoodleUrl(undefined)).toBe(UCL_MOODLE_URL);
    expect(resolveMoodleUrl("  ")).toBe(UCL_MOODLE_URL);
  });

  it("refuses plain http and other hosts", () => {
    expect(() => resolveMoodleUrl("http://moodle.ucl.ac.uk")).toThrow("only supports UCL Moodle");
    expect(() => resolveMoodleUrl("https://moodle.ucl.ac.uk.evil.com")).toThrow("only supports UCL Moodle");
  });
});
