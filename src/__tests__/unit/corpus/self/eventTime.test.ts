/**
 * The event-time ladder, and the thing it must never do: hand back a plausible date that reads as measured.
 * Every case here checks the `timeSource` as well as the instant, because the mark is the deliverable — a
 * mtime-derived date is a fact about the file, not about when the owner thought it.
 */
import { describe, expect, it } from "vitest";

import {
  countTimeSources,
  dateFromFrontmatter,
  dateFromPath,
  GIT_FIRST_ADDED_ARGS,
  parseGitFirstAdded,
  resolveEventTime,
} from "../../../../corpus/self/eventTime.js";

/** The NUL commit separator, written as an escape — a literal 0x00 would make this file read as binary. */
const NUL = "\u0000";

describe("GIT_FIRST_ADDED_ARGS", () => {
  it("asks git for the commit that ADDED each path, which is the only trustworthy event time on disk", () => {
    expect(GIT_FIRST_ADDED_ARGS).toContain("--diff-filter=A");
  });

  it("reverses the log, so the FIRST sighting of a path is its earliest add", () => {
    expect(GIT_FIRST_ADDED_ARGS).toContain("--reverse");
  });

  it("turns off path quoting, because this corpus has non-ASCII filenames", () => {
    expect(GIT_FIRST_ADDED_ARGS).toContain("core.quotePath=false");
  });
});

describe("parseGitFirstAdded", () => {
  it("maps each path to the commit date that added it", () => {
    const parsed = parseGitFirstAdded({
      stdout: `${NUL}2026-07-19T10:00:00+10:00\n\ndaily/a.md\ndaily/b.md\n${NUL}2026-07-20T11:00:00+10:00\n\njunkyard/c.md\n`,
    });

    expect(parsed.get("daily/a.md")).toBe("2026-07-19T10:00:00+10:00");
    expect(parsed.get("daily/b.md")).toBe("2026-07-19T10:00:00+10:00");
    expect(parsed.get("junkyard/c.md")).toBe("2026-07-20T11:00:00+10:00");
  });

  it("keeps the EARLIEST add when a path is added twice (a delete-then-restore)", () => {
    const parsed = parseGitFirstAdded({
      stdout: `${NUL}2026-07-19T10:00:00+10:00\n\nnote.md\n${NUL}2026-08-01T10:00:00+10:00\n\nnote.md\n`,
    });

    expect(parsed.get("note.md")).toBe("2026-07-19T10:00:00+10:00");
  });

  it("handles a path containing spaces, which this corpus has plenty of", () => {
    const parsed = parseGitFirstAdded({
      stdout: `${NUL}2026-06-04T17:00:00+10:00\n\nscratch/meetings/Cycle Planning – Notes.md\n`,
    });

    expect(parsed.get("scratch/meetings/Cycle Planning – Notes.md")).toBe("2026-06-04T17:00:00+10:00");
  });

  it("reads an empty stream as an empty map, not as a failure", () => {
    expect(parseGitFirstAdded({ stdout: "" }).size).toBe(0);
  });

  it("skips a commit that added nothing", () => {
    const parsed = parseGitFirstAdded({ stdout: `${NUL}2026-07-19T10:00:00+10:00\n\n${NUL}\n\nstray.md\n` });

    expect(parsed.size).toBe(0);
  });
});

describe("dateFromFrontmatter", () => {
  it("reads a date the author declared in the leading YAML block", () => {
    expect(dateFromFrontmatter({ text: "---\ntitle: a plan\ndate: 2026-07-14\n---\nbody" })).toBe(
      "2026-07-14T00:00:00.000Z",
    );
  });

  it("reads created: and updated: as well", () => {
    expect(dateFromFrontmatter({ text: "---\ncreated: 2026-01-02\n---\n" })).toBe("2026-01-02T00:00:00.000Z");
    expect(dateFromFrontmatter({ text: "---\nupdated: 2026-01-03\n---\n" })).toBe("2026-01-03T00:00:00.000Z");
  });

  it("ignores a date: line in the BODY, which is not the document's date", () => {
    expect(dateFromFrontmatter({ text: "some prose\n\ndate: 2026-07-14\n" })).toBeUndefined();
  });

  it("returns undefined for a file with no frontmatter", () => {
    expect(dateFromFrontmatter({ text: "## Heading\nbody" })).toBeUndefined();
  });

  it("refuses an impossible date rather than coercing it", () => {
    expect(dateFromFrontmatter({ text: "---\ndate: 2026-02-31\n---\n" })).toBeUndefined();
    expect(dateFromFrontmatter({ text: "---\ndate: 1999-99-99\n---\n" })).toBeUndefined();
  });
});

describe("dateFromPath", () => {
  it("reads the date out of a dated filename", () => {
    expect(dateFromPath({ relPath: "meetings/2026-07-14-a-conversation.txt" })).toBe("2026-07-14T00:00:00.000Z");
  });

  it("reads the date out of a dated directory", () => {
    expect(dateFromPath({ relPath: "daily/2026-06-04/notes.md" })).toBe("2026-06-04T00:00:00.000Z");
  });

  it("returns undefined for an undated path", () => {
    expect(dateFromPath({ relPath: "junkyard/some-idea.md" })).toBeUndefined();
  });
});

describe("resolveEventTime — the ladder, and the mark it leaves", () => {
  const text = "---\ndate: 2026-07-14\n---\nbody";

  it("prefers git, because a commit is when the thought was written down", () => {
    const resolved = resolveEventTime({
      gitIso: "2026-07-19T10:00:00+10:00",
      mtimeIso: "2026-08-05T00:00:00.000Z",
      relPath: "daily/2026-01-01-note.md",
      text,
    });

    expect(resolved.tsIso).toBe("2026-07-19T10:00:00+10:00");
    expect(resolved.timeSource).toBe("git");
  });

  it("falls back to the author's own declared frontmatter date", () => {
    const resolved = resolveEventTime({
      gitIso: undefined,
      mtimeIso: "2026-08-05T00:00:00.000Z",
      relPath: "notes/undated.md",
      text,
    });

    expect(resolved.tsIso).toBe("2026-07-14T00:00:00.000Z");
    expect(resolved.timeSource).toBe("frontmatter");
  });

  it("then to a date in the filename", () => {
    const resolved = resolveEventTime({
      gitIso: undefined,
      mtimeIso: "2026-08-05T00:00:00.000Z",
      relPath: "notes/2026-05-06-idea.md",
      text: "no frontmatter here",
    });

    expect(resolved.tsIso).toBe("2026-05-06T00:00:00.000Z");
    expect(resolved.timeSource).toBe("filename");
  });

  it("lands on mtime as a last resort AND says so, rather than passing it off as measured", () => {
    const resolved = resolveEventTime({
      gitIso: undefined,
      mtimeIso: "2026-08-05T00:00:00.000Z",
      relPath: "notes/undated-idea.md",
      text: "no frontmatter here",
    });

    expect(resolved.tsIso).toBe("2026-08-05T00:00:00.000Z");
    expect(resolved.timeSource).toBe("mtime");
  });

  it("treats an empty git date as absent, not as a date", () => {
    const resolved = resolveEventTime({
      gitIso: "",
      mtimeIso: "2026-08-05T00:00:00.000Z",
      relPath: "notes/undated.md",
      text: "plain",
    });

    expect(resolved.timeSource).toBe("mtime");
  });
});

describe("countTimeSources", () => {
  it("counts each rung, strongest evidence first", () => {
    expect(countTimeSources({ timeSources: ["mtime", "git", "git", "filename"] })).toEqual([
      { count: 2, source: "git" },
      { count: 1, source: "filename" },
      { count: 1, source: "mtime" },
    ]);
  });

  it("omits a rung nothing landed on", () => {
    expect(countTimeSources({ timeSources: ["git"] })).toEqual([{ count: 1, source: "git" }]);
  });

  it("counts nothing for no files", () => {
    expect(countTimeSources({ timeSources: [] })).toEqual([]);
  });
});
