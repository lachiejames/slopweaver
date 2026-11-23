import { describe, expect, it } from "vitest";

import { TOOL_DETAIL_MAX, verbToolDetail } from "../../components/voice/talkToolCalls";

describe("an answered read's log line names what it read", () => {
  it("names a verb by its noun and verb, never its arguments", () => {
    const request = { args: ["https://github.com/o/r/pull/1", "--json"], noun: "github", verb: "read" };
    expect(verbToolDetail({ args: { request }, name: "verb" })).toBe("read slopweaver github read");
  });

  it("quotes the text a code search looked for", () => {
    expect(verbToolDetail({ args: { maxHits: "5", text: "--json" }, name: "code_find" })).toBe(
      'searched tracked files for "--json"',
    );
  });

  it("names the path a file read opened, and where it started", () => {
    expect(verbToolDetail({ args: { path: "/tmp/spill.txt" }, name: "file_read" })).toBe("read /tmp/spill.txt");
    expect(verbToolDetail({ args: { from: 20480, path: "src/a.ts" }, name: "code_read" })).toBe(
      "read src/a.ts from 20480",
    );
  });

  it("names the directory a listing walked, or the whole tree", () => {
    expect(verbToolDetail({ args: { dir: "src/talk" }, name: "code_list" })).toBe(
      "listed tracked files under src/talk",
    );
    expect(verbToolDetail({ args: {}, name: "code_list" })).toBe("listed tracked files");
  });

  it("falls back to the tool's name for every other read, and for arguments it cannot read", () => {
    expect(verbToolDetail({ args: { url: "https://example.com" }, name: "browser" })).toBe("read with browser");
    expect(verbToolDetail({ args: { request: "github read" }, name: "verb" })).toBe("read with verb");
  });

  it("cuts a long line to its bound, marking the cut", () => {
    const detail = verbToolDetail({ args: { text: "x".repeat(2000) }, name: "code_find" });
    expect(Array.from(detail).length).toBe(TOOL_DETAIL_MAX);
    expect(detail.endsWith("x…")).toBe(true);
  });
});
