import { describe, expect, it } from "vitest";

import { leftoverReportLines } from "../../../../../cli/commands/codex/leftoverReport.js";
import { statusContextLines } from "../../../../../cli/commands/codex/statusContextLines.js";
import type { FallbackReceiptScan } from "../../../../../codex/fallbackDocuments.js";
import { type TreeFingerprint, treeFingerprint } from "../../../../../codex/fingerprint.js";
import type { OtherCheckoutPassSummary } from "../../../../../codex/otherCheckoutPasses.js";

const HEAD = "4a922ffd7462ee221f3878261530188ccbe6bae0";
const TREE = "bd4336370000000000000000000000000000beef";
const CLEAN = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: TREE });
const NO_RECEIPTS: FallbackReceiptScan = {
  foreign: 0,
  foreignModes: [],
  foreignReceipts: [],
  unboundReceipts: [],
  pending: 0,
  pendingPlans: 0,
  planReceipts: [],
  problems: [],
  receipts: [],
  unreadable: 0,
};
const NOWHERE_ELSE: OtherCheckoutPassSummary = { passCount: 0, roots: [] };
const AUTHOR_HOLDS_THREE: OtherCheckoutPassSummary = { passCount: 3, roots: ["/w/author", "/w/other"] };
const DIRTY_LINE =
  "DIRTY: the rows above are judged against the working tree, which carries 12 byte(s) of uncommitted " +
  "change on HEAD 4a922ffd7462; --check and github enqueue judge the commit, where a pass that read those " +
  "bytes is STALE — commit or discard them, then take that pass again";
const OTHER_LINE =
  "OTHER CHECKOUTS: this checkout has no pass on feature, but 3 pass(es) are recorded for that branch under 2 " +
  "other checkout root(s): /w/author, /w/other; this table stays per-checkout, while --check, github enqueue and " +
  "github merge --admin fold every qualifying checkout that holds the head commit";

/** The context lines for a clean, receipt-less report, with the parts a case varies. */
function contextOf({
  localPassCount = 0,
  now = CLEAN,
  otherCheckouts = NOWHERE_ELSE,
  receipts = NO_RECEIPTS,
}: {
  localPassCount?: number;
  now?: TreeFingerprint | undefined;
  otherCheckouts?: OtherCheckoutPassSummary;
  receipts?: FallbackReceiptScan;
}): readonly string[] {
  return statusContextLines({ branch: "feature", localPassCount, now, otherCheckouts, receipts });
}

describe("statusContextLines", () => {
  it("names the uncommitted bytes the rows were judged against, and that a landing judges the commit", () => {
    const now = treeFingerprint({ dirtyPatch: "+local only\n", headSha: HEAD, treeSha: TREE });

    expect(contextOf({ now })).toEqual([DIRTY_LINE]);
  });

  it("prints nothing over a clean tree or one that could not be captured, with nothing elsewhere", () => {
    expect([contextOf({}), contextOf({ now: undefined })]).toEqual([[], []]);
  });

  it("names where the branch's passes are when this checkout holds none and another does", () => {
    expect(contextOf({ otherCheckouts: AUTHOR_HOLDS_THREE })).toEqual([OTHER_LINE]);
  });

  it("says nothing of other checkouts when this one holds its own rows", () => {
    expect(contextOf({ localPassCount: 1, otherCheckouts: AUTHOR_HOLDS_THREE })).toEqual([]);
  });

  it("prints DIRTY, then OTHER CHECKOUTS, then the fallback scan's lines", () => {
    const now = treeFingerprint({ dirtyPatch: "+local only\n", headSha: HEAD, treeSha: TREE });

    expect(
      contextOf({
        now,
        otherCheckouts: AUTHOR_HOLDS_THREE,
        receipts: { ...NO_RECEIPTS, pending: 1, pendingPlans: 2 },
      }),
    ).toEqual([
      DIRTY_LINE,
      OTHER_LINE,
      "PENDING: 1 Claude fallback review request(s) prepared and not yet recorded",
      "PENDING: 2 Claude fallback plan request(s) prepared and not yet recorded",
    ]);
  });
});

describe("leftoverReportLines", () => {
  it("prints the heading line, one line per leftover, a missing summary said, and the acknowledgement", () => {
    expect(
      leftoverReportLines({
        leftovers: [
          { artifactId: "art-7", pass: "r2", propertyId: "r2-08", summary: "the retry\nloses a write" },
          { artifactId: "art-9", pass: "r3", propertyId: "r3-01", summary: undefined },
        ],
      }),
    ).toEqual([
      "codex status --check: 2 finding(s) stand after the second and last review pass — the landing verbs raise " +
        "codex-loop-incomplete for each:",
      "- r2/r2-08 (art-7): the retry loses a write",
      "- r3/r3-01 (art-9): the review recorded no summary",
      'land with them standing only by saying why: --acknowledge codex-loop-incomplete --reason "<why it lands anyway>"',
    ]);
  });

  it("prints nothing when no finding stands", () => {
    expect(leftoverReportLines({ leftovers: [] })).toEqual([]);
  });
});
