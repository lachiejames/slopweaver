/*
 * The evidence one branch's readers fold (`src/codex/branchContinuityView.ts`): a proven predecessor's rows shown
 * under the judged branch's name inside their window, and every other row untouched. Pure: plain values in and out.
 */
import { describe, expect, it } from "vitest";

import type { BranchContinuity } from "../../../codex/branchContinuity.js";
import { evidenceForBranch, namesAnotherBranch } from "../../../codex/branchContinuityView.js";
import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import type { LedgerScan } from "../../../codex/ledgerStore.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import { receiptFor, request } from "./fallbackReview/harness.js";
import { HEAD, planRecord, REPO, treeOn } from "./ledger/fixtures.js";

const TARGET = "feature/abc-1";
const DRAFT = "feature/abc-1-draft";
const CLONE = "/w/acme-clone";
const LINKED_AT_ISO = "2026-08-02T02:00:00.000Z";
const LINKED_AT = Date.parse(LINKED_AT_ISO) / 1000;

/** A rename of {@link DRAFT} into {@link TARGET}, seen from a repository whose only checkout is {@link REPO}. */
const RENAMED: BranchContinuity = {
  roots: new Set([REPO]),
  target: TARGET,
  windows: [{ afterEpochSeconds: undefined, branch: DRAFT, root: undefined, throughEpochSeconds: LINKED_AT }],
};

/** An empty receipt scan, which a case extends with the receipts it is about. */
const NO_RECEIPTS: FallbackReceiptScan = {
  foreign: 0,
  foreignModes: [],
  foreignReceipts: [],
  pending: 0,
  pendingPlans: 0,
  planReceipts: [],
  problems: [],
  receipts: [],
  unboundReceipts: [],
  unreadable: 0,
};

/** A plan record taken on `branch` in `repoRoot` at `createdAtIso`. */
function recordOn({
  branch,
  createdAtIso,
  repoRoot = REPO,
}: {
  branch: string;
  createdAtIso: string;
  repoRoot?: string;
}): CodexArtifactRecord {
  return { ...planRecord({ createdAtIso, pass: "p2", tree: treeOn({ branch, headSha: HEAD, patch: "" }) }), repoRoot };
}

/** A pass-record scan holding exactly `records`. */
function scanOf({ records }: { records: readonly CodexArtifactRecord[] }): LedgerScan {
  return { records, unreadable: 0, withoutSidecar: 0 };
}

/** The branch every record of a viewed scan is folded under, in order. */
function branchesOf({ scan }: { scan: LedgerScan }): readonly (string | null)[] {
  return scan.records.map((record) => record.tree!.branch);
}

describe("evidenceForBranch", () => {
  it("shows a predecessor's record from before the rename under the judged branch's name", () => {
    const viewed = evidenceForBranch({
      continuity: RENAMED,
      receipts: NO_RECEIPTS,
      scan: scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z" })] }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([TARGET]);
  });

  it("carries a record made in the very second of the rename", () => {
    const viewed = evidenceForBranch({
      continuity: RENAMED,
      receipts: NO_RECEIPTS,
      scan: scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T02:00:00.900Z" })] }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([TARGET]);
  });

  it("leaves a record made on the old name after the rename where it was recorded", () => {
    const viewed = evidenceForBranch({
      continuity: RENAMED,
      receipts: NO_RECEIPTS,
      scan: scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T02:00:01.000Z" })] }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([DRAFT]);
  });

  it("leaves a record from a clone at another path where it was recorded", () => {
    const viewed = evidenceForBranch({
      continuity: RENAMED,
      receipts: NO_RECEIPTS,
      scan: scanOf({
        records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z", repoRoot: CLONE })],
      }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([DRAFT]);
  });

  it("carries a cut's record only from the checkout whose HEAD moved", () => {
    const cut: BranchContinuity = {
      roots: new Set([REPO, CLONE]),
      target: TARGET,
      windows: [{ afterEpochSeconds: undefined, branch: DRAFT, root: REPO, throughEpochSeconds: LINKED_AT }],
    };
    const viewed = evidenceForBranch({
      continuity: cut,
      receipts: NO_RECEIPTS,
      scan: scanOf({
        records: [
          recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z" }),
          recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z", repoRoot: CLONE }),
        ],
      }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([TARGET, DRAFT]);
  });

  it("leaves a record from before the predecessor's previous continuation where it was recorded", () => {
    const later: BranchContinuity = {
      ...RENAMED,
      windows: [{ ...RENAMED.windows[0]!, afterEpochSeconds: Date.parse("2026-08-02T01:30:00.000Z") / 1000 }],
    };
    const viewed = evidenceForBranch({
      continuity: later,
      receipts: NO_RECEIPTS,
      scan: scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z" })] }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([DRAFT]);
  });

  it("relabels a fallback review receipt by the instant its request was prepared", () => {
    const before = receiptFor({
      req: request({
        createdAtIso: "2026-08-02T01:00:00.000Z",
        tree: treeOn({ branch: DRAFT, headSha: HEAD, patch: "" }),
      }),
    });
    const after = receiptFor({
      req: request({
        createdAtIso: "2026-08-02T03:00:00.000Z",
        tree: treeOn({ branch: DRAFT, headSha: HEAD, patch: "" }),
      }),
    });
    const viewed = evidenceForBranch({
      continuity: RENAMED,
      receipts: { ...NO_RECEIPTS, receipts: [before, after] },
      scan: scanOf({ records: [] }),
    });
    expect(viewed.receipts.receipts.map((receipt) => receipt.request.tree.branch)).toEqual([TARGET, DRAFT]);
  });

  it("carries nothing from a predecessor holding a foreign placement in its scope, and never relabels the placement", () => {
    const viewed = evidenceForBranch({
      continuity: RENAMED,
      receipts: {
        ...NO_RECEIPTS,
        foreignReceipts: [{ branch: DRAFT, mode: "future-mode", repoRoot: REPO, requestId: "req-foreign" }],
      },
      scan: scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z" })] }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([DRAFT]);
    expect(viewed.receipts.foreignReceipts.map((placement) => placement.branch)).toEqual([DRAFT]);
  });

  it("carries nothing from a predecessor holding an unbound placement in its scope", () => {
    const viewed = evidenceForBranch({
      continuity: RENAMED,
      receipts: {
        ...NO_RECEIPTS,
        unboundReceipts: [{ branch: DRAFT, problem: "bytes changed", repoRoot: REPO, requestId: "req-unbound" }],
      },
      scan: scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z" })] }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([DRAFT]);
    expect(viewed.receipts.unboundReceipts.map((placement) => placement.branch)).toEqual([DRAFT]);
  });

  it("still carries a predecessor whose only placement sits outside its scope", () => {
    const viewed = evidenceForBranch({
      continuity: RENAMED,
      receipts: {
        ...NO_RECEIPTS,
        unboundReceipts: [{ branch: DRAFT, problem: "bytes changed", repoRoot: CLONE, requestId: "req-unbound" }],
      },
      scan: scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z" })] }),
    });
    expect(branchesOf({ scan: viewed.scan })).toEqual([TARGET]);
    expect(viewed.receipts.unboundReceipts.map((placement) => placement.branch)).toEqual([DRAFT]);
  });

  it("never touches a disk row: the scan it was handed keeps the name the record was taken on", () => {
    const scan = scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z" })] });
    evidenceForBranch({ continuity: RENAMED, receipts: NO_RECEIPTS, scan });
    expect(branchesOf({ scan })).toEqual([DRAFT]);
  });
});

describe("namesAnotherBranch", () => {
  it("is false when every row is on the judged branch, so no reflog need be read", () => {
    expect(
      namesAnotherBranch({
        branch: TARGET,
        receipts: NO_RECEIPTS,
        scan: scanOf({ records: [recordOn({ branch: TARGET, createdAtIso: "2026-08-02T01:00:00.000Z" })] }),
      }),
    ).toBe(false);
  });

  it("is true when a record names another branch", () => {
    expect(
      namesAnotherBranch({
        branch: TARGET,
        receipts: NO_RECEIPTS,
        scan: scanOf({ records: [recordOn({ branch: DRAFT, createdAtIso: "2026-08-02T01:00:00.000Z" })] }),
      }),
    ).toBe(true);
  });

  it("is true when only a placement names another branch", () => {
    expect(
      namesAnotherBranch({
        branch: TARGET,
        receipts: {
          ...NO_RECEIPTS,
          unboundReceipts: [{ branch: DRAFT, problem: "bytes changed", repoRoot: REPO, requestId: "req-unbound" }],
        },
        scan: scanOf({ records: [] }),
      }),
    ).toBe(true);
  });
});
