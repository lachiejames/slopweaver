import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SlackCursorWriteErrors } from "../../../../corpus/slack/cursorWriteErrors.js";
import {
  isSlackTs,
  latestReplyTs,
  migrateThreadCursorFile,
  newerReplies,
  readThreadCursors,
  threadKey,
  writeThreadCursors,
} from "../../../../corpus/slack/threadCursors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-threads-"));
  fixtureDirs.push(root);
  return join(root, "home");
}

describe("threadKey", () => {
  it("keys by channel + thread ts", () => {
    expect(threadKey({ channel: "C_A", threadTs: "1700000000.000100" })).toBe("C_A:1700000000.000100");
  });
});

describe("newerReplies", () => {
  it("keeps only replies strictly newer than the stored cursor (drops the inclusive boundary)", () => {
    const replies = [{ ts: "1.0" }, { ts: "2.0" }, { ts: "3.0" }];
    expect(newerReplies({ afterTs: "2.0", replies }).map((r) => r.ts)).toEqual(["3.0"]);
  });

  it("returns every reply when there is no stored cursor", () => {
    const replies = [{ ts: "1.0" }, { ts: "2.0" }];
    expect(newerReplies({ afterTs: undefined, replies })).toHaveLength(2);
  });
});

describe("latestReplyTs", () => {
  it("returns the numeric-max ts across the current cursor and new replies", () => {
    expect(latestReplyTs({ current: "1.0", replies: [{ ts: "3.0" }, { ts: "2.0" }] })).toBe("3.0");
  });

  it("keeps the current cursor when there are no newer replies", () => {
    expect(latestReplyTs({ current: "5.0", replies: [] })).toBe("5.0");
  });

  it("is undefined when there is neither a cursor nor a reply", () => {
    expect(latestReplyTs({ current: undefined, replies: [] })).toBeUndefined();
  });
});

describe("read/write round-trip", () => {
  it("persists and reads back the cursor map", () => {
    const home = tempHome();
    const cursors = { "C_A:1.1": { replyCount: 3, ts: "2.0" }, "C_B:3.3": { ts: "4.0" } };
    unwrap(writeThreadCursors({ cursors, home }));
    expect(readThreadCursors({ home })).toEqual(cursors);
  });

  it("degrades to an empty map when no store exists", () => {
    expect(readThreadCursors({ home: tempHome() })).toEqual({});
  });
});

/** Write a raw `.slack-threads.json` body under `home`, bypassing the writer, to test what the reader makes of it. */
function writeRawStore({ home, body }: { home: string; body: string }): string {
  const path = stateHomePaths({ home }).corpus.slackThreads;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
  return path;
}

describe("isSlackTs", () => {
  it("accepts a well-formed epochSeconds.micros timestamp", () => {
    expect(isSlackTs("1700000000.000100")).toBe(true);
  });

  it("rejects a value with the wrong micros width, no dot, or the wrong type", () => {
    expect(isSlackTs("1700000000.0001")).toBe(false);
    expect(isSlackTs("1700000000")).toBe(false);
    expect(isSlackTs(1_700_000_000)).toBe(false);
    expect(isSlackTs(undefined)).toBe(false);
  });
});

describe("migrateThreadCursorFile", () => {
  it("lifts a flat-string map, leaving every count unknown", () => {
    const read = migrateThreadCursorFile({ raw: { "C_A:1.1": "2.0", "C_B:3.3": "4.0" } });
    expect(read.shape).toBe("flat-string");
    expect(read.cursors).toEqual({ "C_A:1.1": { ts: "2.0" }, "C_B:3.3": { ts: "4.0" } });
    expect(read.warnings).toEqual([]);
  });

  it("reads the versioned shape, count included", () => {
    const read = migrateThreadCursorFile({
      raw: { threads: { "C_A:1.1": { replyCount: 7, ts: "2.0" } }, version: 2 },
    });
    expect(read.shape).toBe("v2");
    expect(read.cursors).toEqual({ "C_A:1.1": { replyCount: 7, ts: "2.0" } });
  });

  it("drops a versioned entry with no usable ts, and a non-numeric count", () => {
    const read = migrateThreadCursorFile({
      raw: {
        threads: { "C_A:1.1": { replyCount: "seven", ts: "2.0" }, "C_B:3.3": { ts: "" }, "C_C:5.5": 9 },
        version: 2,
      },
    });
    expect(read.cursors).toEqual({ "C_A:1.1": { ts: "2.0" } });
  });

  it("reads an empty object as an absent store rather than a flat-string one", () => {
    const read = migrateThreadCursorFile({ raw: {} });
    expect(read.shape).toBe("absent");
    expect(read.cursors).toEqual({});
  });

  it("WARNS on a shape it recognises neither way, instead of silently claiming no thread was ever read", () => {
    const read = migrateThreadCursorFile({ raw: { "C_A:1.1": { unexpected: true } } });
    expect(read.shape).toBe("unrecognised");
    expect(read.cursors).toEqual({});
    expect(read.warnings[0]).toContain("every thread will be re-read");
  });

  it("warns when the file is not an object at all", () => {
    const read = migrateThreadCursorFile({ raw: [1, 2, 3] });
    expect(read.shape).toBe("unrecognised");
    expect(read.warnings[0]).toContain("not an object");
  });
});

describe("a flat-string store on disk", () => {
  it("is migrated in place by the reader — a real file, not a literal", () => {
    const home = tempHome();
    writeRawStore({ body: '{"C_A:1.1":"2.0"}\n', home });
    expect(readThreadCursors({ home })).toEqual({ "C_A:1.1": { ts: "2.0" } });
  });

  it("round-trips through the writer into the versioned shape", () => {
    const home = tempHome();
    writeRawStore({ body: '{"C_A:1.1":"2.0"}\n', home });
    const migrated = readThreadCursors({ home });
    unwrap(writeThreadCursors({ cursors: { ...migrated, "C_A:1.1": { replyCount: 2, ts: "2.0" } }, home }));
    const path = stateHomePaths({ home }).corpus.slackThreads;
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      threads: { "C_A:1.1": { replyCount: 2, ts: "2.0" } },
      version: 2,
    });
    expect(readThreadCursors({ home })).toEqual({ "C_A:1.1": { replyCount: 2, ts: "2.0" } });
  });

  it("names the store and its path when the write fails", () => {
    const home = tempHome();
    const path = stateHomePaths({ home }).corpus.slackThreads;
    // A non-empty directory where the file belongs: the atomic rename onto it fails.
    mkdirSync(join(path, "occupied"), { recursive: true });
    const failed = unwrapErr(writeThreadCursors({ cursors: {}, home }));
    expect(failed.code).toBe("THREAD_CURSORS_WRITE_FAILED");
    expect(failed.path).toBe(path);
    expect(failed.message).toBe((failed.cause as Error).message);
  });

  it("falls back to naming the path when the cause is not an Error", () => {
    expect(SlackCursorWriteErrors.threadCursorsFailed({ cause: "x", path: "/h/t.json" }).message).toBe(
      "failed to write /h/t.json",
    );
    expect(SlackCursorWriteErrors.channelWatermarkFailed({ cause: 7, path: "/h/w.json" })).toEqual({
      cause: 7,
      code: "CHANNEL_WATERMARK_WRITE_FAILED",
      message: "failed to write per-channel watermark /h/w.json",
      path: "/h/w.json",
    });
  });
});
