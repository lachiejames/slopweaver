/**
 * The backfill floor — the cursor that makes a full-history mailbox crawl converge instead of looping.
 *
 * Round-trips through a real temp directory rather than a fake filesystem: the store's whole job is to keep
 * two independent records in one file without either write losing the other, and that is a property of the
 * bytes on disk.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readGmailBackfillFloor,
  readGmailHistoryAnchor,
  writeGmailBackfillFloor,
  writeGmailHistoryAnchor,
} from "../../../../corpus/gmail/historyAnchor.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

const NOW = "2026-08-29T00:00:00.000Z";
const LATER = "2026-08-30T00:00:00.000Z";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-gmail-floor-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus"), { recursive: true });
  return home;
}

describe("readGmailBackfillFloor", () => {
  it("is undefined on a home that has never run a backfill", () => {
    expect(readGmailBackfillFloor({ home: freshHome() })).toBe(undefined);
  });

  it("round-trips a written floor", () => {
    const home = freshHome();
    unwrap(writeGmailBackfillFloor({ floorIso: "2026-05-01T00:00:00.000Z", home, nowIso: NOW }));

    expect(readGmailBackfillFloor({ home })).toEqual({
      floorIso: "2026-05-01T00:00:00.000Z",
      recordedAtIso: NOW,
    });
  });
});

describe("writeGmailBackfillFloor", () => {
  it("only ever moves the floor BACKWARD, so a pass that re-crawled covered ground cannot undo progress", () => {
    const home = freshHome();
    unwrap(writeGmailBackfillFloor({ floorIso: "2026-05-01T00:00:00.000Z", home, nowIso: NOW }));
    unwrap(writeGmailBackfillFloor({ floorIso: "2026-07-01T00:00:00.000Z", home, nowIso: LATER }));

    expect(readGmailBackfillFloor({ home })?.floorIso).toBe("2026-05-01T00:00:00.000Z");
  });

  it("clears the floor when the backfill converges", () => {
    const home = freshHome();
    unwrap(writeGmailBackfillFloor({ floorIso: "2026-05-01T00:00:00.000Z", home, nowIso: NOW }));
    unwrap(writeGmailBackfillFloor({ floorIso: undefined, home, nowIso: LATER }));

    expect(readGmailBackfillFloor({ home })).toBe(undefined);
  });

  it("leaves the history anchor exactly as it stands", () => {
    const home = freshHome();
    unwrap(writeGmailHistoryAnchor({ fullCrawl: false, historyId: "4242", home, nowIso: NOW }));
    unwrap(writeGmailBackfillFloor({ floorIso: "2026-05-01T00:00:00.000Z", home, nowIso: LATER }));

    expect(readGmailHistoryAnchor({ home })).toEqual({
      anchoredAtIso: NOW,
      fullCrawl: false,
      historyId: "4242",
    });
  });

  it("records a floor on a home with NO anchor, which is the first-pass case the anchor cannot serve", () => {
    const home = freshHome();
    unwrap(writeGmailBackfillFloor({ floorIso: "2026-05-01T00:00:00.000Z", home, nowIso: NOW }));

    expect(readGmailHistoryAnchor({ home })).toBe(undefined);
    expect(readGmailBackfillFloor({ home })?.floorIso).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("writeGmailHistoryAnchor alongside a floor", () => {
  it("carries a part-finished backfill through, rather than silently restarting it from today", () => {
    const home = freshHome();
    unwrap(writeGmailBackfillFloor({ floorIso: "2026-05-01T00:00:00.000Z", home, nowIso: NOW }));
    unwrap(writeGmailHistoryAnchor({ fullCrawl: false, historyId: "77", home, nowIso: LATER }));

    expect(readGmailBackfillFloor({ home })?.floorIso).toBe("2026-05-01T00:00:00.000Z");
    expect(readGmailHistoryAnchor({ home })?.historyId).toBe("77");
  });

  it("writes both records into one versioned file", () => {
    const home = freshHome();
    unwrap(writeGmailBackfillFloor({ floorIso: "2026-05-01T00:00:00.000Z", home, nowIso: NOW }));
    unwrap(writeGmailHistoryAnchor({ fullCrawl: true, historyId: "77", home, nowIso: LATER }));
    const parsed: unknown = JSON.parse(readFileSync(stateHomePaths({ home }).corpus.gmailHistory, "utf8"));

    expect(parsed).toEqual({
      anchor: { anchoredAtIso: LATER, fullCrawl: true, historyId: "77" },
      backfill: { floorIso: "2026-05-01T00:00:00.000Z", recordedAtIso: NOW },
      version: 1,
    });
  });
});
