import { describe, expect, it } from "vitest";

import { reportScanIntegrity, scanTextFiles } from "../../../lib/textFileScan.js";

/** A reader that serves a fixed map and throws for anything else, so the unreadable branch needs no disk. */
function readerFor({
  contents,
  code = "EACCES",
}: {
  contents: Readonly<Record<string, string>>;
  code?: string;
}): (args: { path: string }) => string {
  return ({ path }) => {
    const text = contents[path];
    if (text === undefined) {
      const error: Error & { code?: string } = new Error("cannot read");
      error.code = code;
      throw error;
    }
    return text;
  };
}

describe("scanTextFiles", () => {
  it("scans every readable file and reports how many it actually read", () => {
    const result = scanTextFiles<string>({
      paths: ["a.ts", "b.ts"],
      readText: readerFor({ contents: { "a.ts": "hit here", "b.ts": "clean" } }),
      scan: ({ content, path }) => (content.includes("hit") ? [path] : []),
    });
    expect(result.hits).toEqual(["a.ts"]);
    expect(result.unreadable).toEqual([]);
    expect(result.scanned).toBe(2);
  });

  it("records an unreadable path instead of silently skipping it", () => {
    const result = scanTextFiles<string>({
      paths: ["a.ts", "locked.ts"],
      readText: readerFor({ contents: { "a.ts": "clean" } }),
      scan: () => [],
    });
    expect(result.unreadable).toEqual([{ path: "locked.ts", reason: "EACCES" }]);
  });

  it("counts only the files it READ, never the files it was given", () => {
    // The exact overclaim measured across seven gates: `clean (N sources scanned)` where N was the length of
    // the input list, printed unchanged while one of those files could not be opened at all.
    const result = scanTextFiles<string>({
      paths: ["a.ts", "locked.ts", "c.ts"],
      readText: readerFor({ contents: { "a.ts": "x", "c.ts": "y" } }),
      scan: () => [],
    });
    expect(result.scanned).toBe(2);
  });

  it("falls back to a stable reason when the failure carries no errno", () => {
    const result = scanTextFiles<string>({
      paths: ["a.ts"],
      readText: () => {
        throw new Error("nope");
      },
      scan: () => [],
    });
    expect(result.unreadable).toEqual([{ path: "a.ts", reason: "read failed" }]);
  });

  it("returns nothing for an empty path list, leaving the caller to judge that", () => {
    const result = scanTextFiles<string>({ paths: [], readText: () => "", scan: () => ["never"] });
    expect(result).toEqual({ hits: [], scanned: 0, unreadable: [] });
  });
});

describe("reportScanIntegrity", () => {
  it("passes a scan that read at least one file and could read everything selected", () => {
    const lines: string[] = [];
    const ok = reportScanIntegrity({
      label: "demo",
      scanned: 3,
      unreadable: [],
      write: (text) => lines.push(text),
    });
    expect(ok).toBe(true);
    expect(lines).toEqual([]);
  });

  it("fails and names EVERY unreadable path, not just the first", () => {
    // Two entries, both asserted. The first version supplied one path and checked `lines[0]`, so an
    // implementation reporting only the head of the list would have passed it — a review pass produced
    // exactly that counterexample (`unreadable.slice(0, 1)`), and a silently-unnamed file is the failure
    // this whole helper exists to prevent.
    const lines: string[] = [];
    const ok = reportScanIntegrity({
      label: "demo",
      scanned: 1,
      unreadable: [
        { path: "locked.ts", reason: "EACCES" },
        { path: "secret.ts", reason: "EPERM" },
      ],
      write: (text) => lines.push(text),
    });
    expect(ok).toBe(false);
    expect(lines.slice(0, 2)).toEqual([
      "  locked.ts  (unreadable: EACCES — NOT checked)\n",
      "  secret.ts  (unreadable: EPERM — NOT checked)\n",
    ]);
  });

  it("fails a scan that selected ZERO files, which a clean result cannot be distinguished from", () => {
    const lines: string[] = [];
    const ok = reportScanIntegrity({ label: "demo", scanned: 0, unreadable: [], write: (text) => lines.push(text) });
    expect(ok).toBe(false);
    expect(lines.join("")).toContain("selected ZERO files");
  });
});
