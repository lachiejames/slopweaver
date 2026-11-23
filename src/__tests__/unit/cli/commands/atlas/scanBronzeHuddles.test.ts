import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scanBronze } from "../../../../../cli/commands/atlas/slackRun.js";
import { stateHomePaths } from "../../../../../stateHome.js";

/** Every scratch home this file minted, removed after each test — see `testing.md` § temp-dir cleanup. */
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home with an empty Slack bronze directory, registered for cleanup. */
function slackBronzeDir(): { home: string; dir: string } {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-scan-bronze-"));
  homes.push(home);
  const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
  mkdirSync(dir, { recursive: true });
  return { dir, home };
}

/** A throwaway home holding one Slack bronze window file with the given JSONL lines. */
function homeWith({ lines }: { lines: readonly string[] }): string {
  const { dir, home } = slackBronzeDir();
  writeFileSync(join(dir, "1970-01-01_2026-08-29.jsonl"), `${lines.join("\n")}\n`, "utf8");
  return home;
}

/** One bronze line carrying a Slack archive permalink, which is where coverage is read from. */
function messageLine({ channel, ts }: { channel: string; ts: string }): string {
  return JSON.stringify({
    attrs: { permalink: `https://example.slack.com/archives/${channel}/p${ts}` },
    kind: "message",
    source: "slack",
    sourceId: `${channel}:${ts}`,
    tsIso: "2026-08-28T02:28:34.000Z",
  });
}

/** One `huddle` bronze line, as `projectSlackRecords` writes them. */
function huddleLine({ attrs, sourceId }: { attrs: Record<string, unknown>; sourceId: string }): string {
  return JSON.stringify({ attrs, kind: "huddle", source: "slack", sourceId, tsIso: "2026-08-28T02:28:34.000Z" });
}

describe("scanBronze — huddles", () => {
  it("counts a chunked huddle ONCE, not once per chunk", () => {
    const attrs = { huddleTranscriptChars: 23_391, huddleTranscriptFileId: "F0BT8F" };
    const home = homeWith({
      lines: [
        huddleLine({ attrs: { ...attrs, chunkCount: 3, chunkIndex: 0 }, sourceId: "huddle:F1:chunk:0" }),
        huddleLine({ attrs: { ...attrs, chunkCount: 3, chunkIndex: 1 }, sourceId: "huddle:F1:chunk:1" }),
        huddleLine({ attrs: { ...attrs, chunkCount: 3, chunkIndex: 2 }, sourceId: "huddle:F1:chunk:2" }),
      ],
    });
    expect(scanBronze({ home }).huddles.length).toBe(1);
  });

  it("reports a chunked huddle's words as present, off the chars attr rather than the chunk count", () => {
    const home = homeWith({
      lines: [
        huddleLine({
          attrs: { huddleTranscriptChars: 26, huddleTranscriptFileId: "F0BT8F" },
          sourceId: "huddle:F1",
        }),
      ],
    });
    expect(scanBronze({ home }).huddles[0]!.hasWords).toBe(true);
  });

  it("reports a pointer-only huddle as having no words, while still naming its transcript file", () => {
    const home = homeWith({
      lines: [huddleLine({ attrs: { huddleTranscriptFileId: "F0BT8F" }, sourceId: "huddle:F1" })],
    });
    const [huddle] = scanBronze({ home }).huddles;
    expect(huddle!.hasWords).toBe(false);
    expect(huddle!.transcriptFileId).toBe("F0BT8F");
  });

  it("treats a huddle line written before attrs existed as a huddle with neither pointer nor words", () => {
    const home = homeWith({
      lines: [
        JSON.stringify({ kind: "huddle", source: "slack", sourceId: "huddle:F1", tsIso: "2026-08-28T00:00:00.000Z" }),
      ],
    });
    const [huddle] = scanBronze({ home }).huddles;
    expect(huddle!.hasWords).toBe(false);
    expect(huddle!.transcriptFileId).toBe(undefined);
  });
});

/**
 * V8's maximum string length, in characters, which for the ASCII/NUL content written below is also bytes.
 * A `readFileSync(path, "utf8")` of anything past this throws rather than returning a long string.
 */
const MAX_STRING_LENGTH = 0x1fffffe8;

/** How far apart the newlines sit in the oversized fixture — the reader's own per-line transient. */
const FILLER_LINE_BYTES = 4 * 1024 * 1024;

/**
 * Write one window file that is genuinely past {@link MAX_STRING_LENGTH}, with a real record at each end.
 *
 * The bulk is a hole: `writeSync` at an offset leaves the bytes between unwritten, and they read back as
 * NUL. A newline every {@link FILLER_LINE_BYTES} keeps the streaming reader's per-line buffer bounded while
 * still forcing the file itself past the ceiling, so the fixture costs ~50 ms to write and ~200 ms to read
 * (measured on the owner's machine) instead of the minutes real content would.
 */
function writeOversizedWindow({ path, head, tail }: { path: string; head: string; tail: string }): void {
  const fd = openSync(path, "w");
  try {
    const headBytes = Buffer.from(`${head}\n`);
    writeSync(fd, headBytes, 0, headBytes.length, 0);
    let offset = headBytes.length;
    const newline = Buffer.from("\n");
    while (offset <= MAX_STRING_LENGTH) {
      offset += FILLER_LINE_BYTES;
      writeSync(fd, newline, 0, 1, offset);
      offset += 1;
    }
    const tailBytes = Buffer.from(`${tail}\n`);
    writeSync(fd, tailBytes, 0, tailBytes.length, offset);
  } finally {
    closeSync(fd);
  }
}

describe("scanBronze — a window past node's string ceiling", () => {
  // The defect this pins: `scanBronze` read each window with `readFileSync(path, "utf8")` inside a bare
  // catch. On a real home the compacted window is several gigabytes, so that read threw, the catch
  // swallowed it, and 99.9% of the corpus vanished from the census and the coverage map at once — with the
  // verb still printing `549 conversation(s) known / ever read 350` as though it had read everything.
  it("still yields its rows, where a whole-file utf8 read cannot even open it", () => {
    const { dir, home } = slackBronzeDir();
    const path = join(dir, "1970-01-01_2026-08-29.jsonl");
    writeOversizedWindow({
      head: huddleLine({ attrs: { huddleTranscriptChars: 1049311, huddleTranscriptFileId: "F0BT8F" }, sourceId: "h1" }),
      path,
      tail: messageLine({ channel: "C9ZZZ", ts: "1785913155614319" }),
    });

    // The control, and the reason this fixture is 512 MiB rather than a convenient 16: without it the test
    // passes against the very implementation it exists to reject.
    expect(() => readFileSync(path, "utf8")).toThrow("Cannot create a string longer than 0x1fffffe8 characters");

    const scan = scanBronze({ home });
    expect(scan.huddles.length).toBe(1);
    expect(scan.huddles[0]!.hasWords).toBe(true);
    expect(scan.readTo.get("C9ZZZ")).toBe("1785913155.614319");
    expect(scan.unreadableWindows).toEqual([]);
  });
});

describe("scanBronze — a window it cannot read", () => {
  /** A path `readdirSync` offers as a `.jsonl` window and `openSync`/`readSync` cannot read: a directory. */
  function withUnreadableWindow({ dir }: { dir: string }): void {
    mkdirSync(join(dir, "2026-08-01_2026-08-02.jsonl"));
  }

  it("REPORTS the window rather than silently skipping it", () => {
    const { dir, home } = slackBronzeDir();
    writeFileSync(join(dir, "1970-01-01_2026-08-29.jsonl"), `${huddleLine({ attrs: {}, sourceId: "h1" })}\n`, "utf8");
    withUnreadableWindow({ dir });

    const scan = scanBronze({ home });

    expect(scan.unreadableWindows.length).toBe(1);
    expect(scan.unreadableWindows[0]!.file).toBe("2026-08-01_2026-08-02.jsonl");
    expect(scan.unreadableWindows[0]!.message).toContain("EISDIR");
  });

  it("keeps every readable window's rows, so one bad file loses only itself", () => {
    const { dir, home } = slackBronzeDir();
    writeFileSync(
      join(dir, "1970-01-01_2026-08-29.jsonl"),
      `${huddleLine({ attrs: { huddleTranscriptChars: 26 }, sourceId: "h1" })}\n${messageLine({ channel: "C1", ts: "1785913155614319" })}\n`,
      "utf8",
    );
    withUnreadableWindow({ dir });

    const scan = scanBronze({ home });

    expect(scan.huddles.length).toBe(1);
    expect(scan.readTo.get("C1")).toBe("1785913155.614319");
  });

  it("reports NOTHING unreadable on a home whose windows all read, so the field is falsifiable", () => {
    const home = homeWith({ lines: [huddleLine({ attrs: {}, sourceId: "h1" })] });

    expect(scanBronze({ home }).unreadableWindows).toEqual([]);
  });
});
