/**
 * Unit: the per-calendar delta cursor, round-tripped through a real temp directory (a genuine fixture, not
 * a mock). The property that matters most is the one that cannot be detected later: a token minted under
 * different parameters is DISCARDED rather than sent, because Google's own contract makes the result of
 * sending it undefined, and undefined means silently missing events.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  calendarSyncAnchorPath,
  readCalendarSyncAnchors,
  resumableToken,
  writeCalendarSyncAnchor,
} from "../../../../corpus/calendar/syncAnchor.js";
import { unwrap } from "../../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-calendar-anchor-"));
  fixtureDirs.push(dir);
  return dir;
}

const ANCHORS = {
  "me@example.test": {
    parameterFingerprint: "abc123",
    recordedAtIso: "2026-09-05T12:00:00.000Z",
    syncToken: "tok-primary",
  },
  "team@example.test": {
    parameterFingerprint: "abc123",
    recordedAtIso: "2026-09-05T12:00:00.000Z",
    syncToken: "tok-team",
  },
};

describe("writeCalendarSyncAnchor / readCalendarSyncAnchors", () => {
  it("round-trips every calendar's token", () => {
    const dir = home();
    expect(unwrap(writeCalendarSyncAnchor({ anchors: ANCHORS, home: dir }))).toBe(
      calendarSyncAnchorPath({ home: dir }),
    );
    expect(readCalendarSyncAnchors({ home: dir })).toStrictEqual(ANCHORS);
  });

  it("reads a home that has never been anchored as EMPTY rather than as an error", () => {
    expect(readCalendarSyncAnchors({ home: home() })).toStrictEqual({});
  });

  it("reads a CORRUPT file as empty, because the recovery for a bad cursor is a window crawl", () => {
    const dir = home();
    const path = calendarSyncAnchorPath({ home: dir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    expect(readCalendarSyncAnchors({ home: dir })).toStrictEqual({});
  });

  it("drops an entry missing its fingerprint rather than trusting a token it cannot check", () => {
    const dir = home();
    const path = calendarSyncAnchorPath({ home: dir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ "a@x.test": { syncToken: "t" }, ...ANCHORS }));
    expect(Object.keys(readCalendarSyncAnchors({ home: dir })).toSorted()).toStrictEqual([
      "me@example.test",
      "team@example.test",
    ]);
  });
});

describe("resumableToken", () => {
  it("resumes a calendar whose stored fingerprint matches this run's parameters", () => {
    expect(resumableToken({ anchors: ANCHORS, calendarId: "me@example.test", fingerprint: "abc123" })).toBe(
      "tok-primary",
    );
  });

  it("DISCARDS a token minted under different parameters, because sending it is undefined behaviour", () => {
    expect(resumableToken({ anchors: ANCHORS, calendarId: "me@example.test", fingerprint: "changed" })).toBe(undefined);
  });

  it("is undefined for a calendar that has never been anchored", () => {
    expect(resumableToken({ anchors: ANCHORS, calendarId: "new@example.test", fingerprint: "abc123" })).toBe(undefined);
  });
});
