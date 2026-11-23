/**
 * Unit: the `outlook-calendar` modified-time anchors round-trip through a real temp home, and a missing, corrupt
 * or partly malformed file reads as what it can prove — never an error, because the recovery for a lost anchor
 * is one full read that dedups.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import {
  type OutlookCalendarSyncAnchors,
  outlookCalendarSyncAnchorPath,
  readOutlookCalendarSyncAnchors,
  writeOutlookCalendarSyncAnchors,
} from "../../../../corpus/outlookCalendar/syncAnchor.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-outlook-anchor-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Write raw bytes where the anchors live, creating the directory. */
function plant({ dir, contents }: { dir: string; contents: string }): void {
  const path = outlookCalendarSyncAnchorPath({ home: dir });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

const ANCHORS: OutlookCalendarSyncAnchors = {
  main: { modifiedThroughIso: "2001-01-10T12:00:00.000Z", recordedAtIso: "2001-01-10T12:05:00.000Z", version: 1 },
};

describe("the Outlook calendar sync anchors", () => {
  it("live under the corpus watermarks", () => {
    expect(outlookCalendarSyncAnchorPath({ home: "/h" })).toBe("/h/corpus/watermarks/outlook-calendar-sync.json");
  });

  it("round-trip through the file", () => {
    const dir = home();
    expect(unwrap(writeOutlookCalendarSyncAnchors({ anchors: ANCHORS, home: dir }))).toBe(
      outlookCalendarSyncAnchorPath({ home: dir }),
    );
    expect(readOutlookCalendarSyncAnchors({ home: dir })).toEqual(ANCHORS);
  });

  it("read as empty when none is stored", () => {
    expect(readOutlookCalendarSyncAnchors({ home: home() })).toEqual({});
  });

  it("read as empty when the file will not parse", () => {
    const dir = home();
    plant({ contents: "{not json", dir });
    expect(readOutlookCalendarSyncAnchors({ home: dir })).toEqual({});
  });

  it("keep the well-formed entries and drop a malformed one", () => {
    const dir = home();
    plant({ contents: JSON.stringify({ ...ANCHORS, broken: { modifiedThroughIso: 7, version: 1 } }), dir });
    expect(readOutlookCalendarSyncAnchors({ home: dir })).toEqual(ANCHORS);
  });
});
