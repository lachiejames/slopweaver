/**
 * The merge hold's durable edge, against a real `mkdtempSync` home — a round-trip, not a mock. The two
 * properties that matter are that a home which has never held anything reports no hold (so no merge is
 * refused by an absent file) and that what was written reads back exactly.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HOLD_STALE_MINUTES, type MergeHold } from "../../../../outbound/github/mergeHold.js";
import { mergeHoldPath, readMergeHolds, writeMergeHolds } from "../../../../outbound/github/mergeHoldStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-merge-hold-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One standing hold; a case overrides only the field it is about. */
function hold(over: Partial<MergeHold> = {}): MergeHold {
  return {
    atIso: "2026-08-28T01:00:00.000Z",
    holder: "a-session",
    pr: 32,
    repo: "owner/name",
    staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
    staleWarnedAtIso: undefined,
    why: "rebase hell",
    ...over,
  };
}

describe("readMergeHolds", () => {
  it("reports no hold for a home that has never placed one", () => {
    expect(readMergeHolds({ home })).toEqual([]);
  });

  it("reports no hold for a document that is not JSON, rather than throwing into a merge", () => {
    writeMergeHolds({ holds: [hold()], home });
    writeFileSync(mergeHoldPath({ home }), "{ not json");

    expect(readMergeHolds({ home })).toEqual([]);
  });
});

describe("writeMergeHolds", () => {
  it("reads back exactly what it wrote", () => {
    const written = writeMergeHolds({ holds: [hold(), hold({ pr: 7, repo: "owner/other" })], home });

    expect(written.isOk()).toBe(true);
    expect(readMergeHolds({ home })).toEqual([hold(), hold({ pr: 7, repo: "owner/other" })]);
  });

  it("replaces the whole set, so a release leaves nothing behind", () => {
    writeMergeHolds({ holds: [hold()], home });
    writeMergeHolds({ holds: [], home });

    expect(readMergeHolds({ home })).toEqual([]);
  });

  it("writes into the state home's own declared path, never one derived here", () => {
    writeMergeHolds({ holds: [hold()], home });

    expect(mergeHoldPath({ home })).toBe(stateHomePaths({ home }).live.github.mergeHoldJson);
    expect(JSON.parse(readFileSync(mergeHoldPath({ home }), "utf8")).version).toBe(1);
  });

  it("creates its directory owner-only, matching every other live/ surface", () => {
    writeMergeHolds({ holds: [hold()], home });

    expect(statSync(stateHomePaths({ home }).live.github.root).mode & 0o777).toBe(0o700);
  });
});
