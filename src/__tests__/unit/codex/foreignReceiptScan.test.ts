/**
 * An answered fallback request in a mode this build cannot read refuses the ONE branch it names, never the
 * install: `scanFallbackDocuments` places it, `foreignReceiptScanReason` scopes it, and `incompleteScanReason`
 * carries it to the landing floor. The mode `triage` stands for any kind a newer build adds.
 */
import { describe, expect, it } from "vitest";

import { scanFallbackDocuments } from "../../../codex/fallbackDocuments.js";
import { foreignReceiptScanReason, incompleteScanReason } from "../../../codex/scanReasons.js";

const CLEAN_RECORDS = { records: [], unreadable: 0, withoutSidecar: 0 };
const CLEAN_LEDGER = { entries: [], unattributed: 0, unknowable: 0, unplaceable: [] };

function triage({ branch, repoRoot }: { branch: string | null; repoRoot: string }): string {
  return JSON.stringify({ mode: "triage", repoRoot, tree: { branch } });
}

const ANSWERED = scanFallbackDocuments({
  documents: [
    { receiptText: "{}", requestId: "req-1", requestText: triage({ branch: "feature", repoRoot: "/w/repo" }) },
  ],
});

const REASON =
  "1 Claude fallback receipt(s) on feature declare a kind this build cannot read, so its plan or review may " +
  "be the one that decides the floor: req-1 (triage, in /w/repo). Run this from a checkout that knows the " +
  "kind — pull or rebase this one onto the base branch, then `slopweaver dev build`";

describe("scanFallbackDocuments places an answered foreign request", () => {
  it("keeps its id, mode, checkout and branch, and still counts it foreign, never unreadable", () => {
    expect(ANSWERED.foreignReceipts).toEqual([
      { branch: "feature", mode: "triage", repoRoot: "/w/repo", requestId: "req-1" },
    ]);
    expect(ANSWERED.foreign).toBe(1);
    expect(ANSWERED.unreadable).toBe(0);
  });

  it("counts an UNANSWERED one but does not place it — it carries no verdict", () => {
    const scan = scanFallbackDocuments({
      documents: [
        { receiptText: null, requestId: "req-2", requestText: triage({ branch: "feature", repoRoot: "/w/repo" }) },
      ],
    });
    expect(scan.foreign).toBe(1);
    expect(scan.foreignReceipts).toEqual([]);
  });

  it("does not place a detached one, or one naming no checkout", () => {
    const scan = scanFallbackDocuments({
      documents: [
        { receiptText: "{}", requestId: "req-3", requestText: triage({ branch: null, repoRoot: "/w/repo" }) },
        { receiptText: "{}", requestId: "req-4", requestText: JSON.stringify({ mode: "triage" }) },
      ],
    });
    expect(scan.foreign).toBe(2);
    expect(scan.foreignReceipts).toEqual([]);
  });
});

describe("foreignReceiptScanReason", () => {
  it("refuses the branch and checkout the receipt names, naming it and the remedy", () => {
    expect(foreignReceiptScanReason({ branch: "feature", receipts: ANSWERED, repoRoots: new Set(["/w/repo"]) })).toBe(
      REASON,
    );
  });

  it("says nothing about another branch of the same checkout", () => {
    expect(
      foreignReceiptScanReason({ branch: "other", receipts: ANSWERED, repoRoots: new Set(["/w/repo"]) }),
    ).toBeUndefined();
  });

  it("says nothing about the same branch name in a checkout not being judged", () => {
    expect(
      foreignReceiptScanReason({ branch: "feature", receipts: ANSWERED, repoRoots: new Set(["/w/elsewhere"]) }),
    ).toBeUndefined();
  });
});

describe("incompleteScanReason carries the branch-local refusal to the floor", () => {
  it("returns it for the judged branch, so older survivors are never judged", () => {
    expect(
      incompleteScanReason({
        branch: "feature",
        ledger: CLEAN_LEDGER,
        receipts: ANSWERED,
        repoRoots: new Set(["/w/repo"]),
        scan: CLEAN_RECORDS,
      }),
    ).toBe(REASON);
  });

  it("reads every other branch as complete", () => {
    expect(
      incompleteScanReason({
        branch: "other",
        ledger: CLEAN_LEDGER,
        receipts: ANSWERED,
        repoRoots: new Set(["/w/repo"]),
        scan: CLEAN_RECORDS,
      }),
    ).toBeUndefined();
  });
});
