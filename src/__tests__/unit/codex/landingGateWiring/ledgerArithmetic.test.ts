/**
 * The landing floor's pure ledger arithmetic, split from the wiring proofs beside it by describe block: how
 * `unionLedger` folds several checkouts' ledgers into one, and what `incompleteScanReason` names when a
 * recorded pass could not capture a tree. Neither needs a checkout, so neither needs the real-git harness.
 *
 * Zero mocks: every edge is a plain function this file writes, per `.claude/rules/testing.md`.
 */

import { describe, expect, it } from "vitest";

import type { FallbackReceiptScan } from "../../../../codex/fallbackDocuments.js";
import type { BranchLedger, LedgerEntry } from "../../../../codex/ledger.js";
import { unionLedger } from "../../../../codex/ledgerUnion.js";
import { incompleteScanReason } from "../../../../codex/scanReasons.js";
import type { UnplaceableRecord } from "../../../../codex/unplaceable.js";

/**
 * The union's ORDER is load-bearing rather than cosmetic: `loopFailures` reads the first conclusive plan as
 * the latest word, and concatenating two already-sorted lists does not produce a sorted one. A pure test,
 * because the rule is arithmetic over rows and needs no checkout to state.
 */
describe("unionLedger", () => {
  /** One row, carrying only the fields the merge orders by. */
  function row({ artifactId, createdAtIso }: { artifactId: string; createdAtIso: string }): LedgerEntry {
    return {
      artifactId,
      capped: false,
      createdAtIso,
      diffSha256: undefined,
      freshness: { kind: "current" },
      mode: "review",
      outcomeContext: undefined,
      pass: "r1",
      propertyId: "r1-01",
      provider: "codex",
      reviewSummary: undefined,
      superseded: undefined,
      verdict: "CLEAN",
    };
  }

  function ledgerOf({ entries }: { entries: readonly LedgerEntry[] }): BranchLedger {
    return { entries, unattributed: 0, unknowable: 0, unplaceable: [] };
  }

  function fold({ ledgers }: { ledgers: readonly BranchLedger[] }): BranchLedger {
    return unionLedger({ ledgers: ledgers.map((ledger) => ({ alwaysCount: false, ledger })) });
  }

  it("interleaves two checkouts' rows newest first, rather than concatenating them", () => {
    const a = ledgerOf({
      entries: [
        row({ artifactId: "a-new", createdAtIso: "2026-09-16T03:00:00.000Z" }),
        row({ artifactId: "a-old", createdAtIso: "2026-09-16T01:00:00.000Z" }),
      ],
    });
    const b = ledgerOf({ entries: [row({ artifactId: "b-mid", createdAtIso: "2026-09-16T02:00:00.000Z" })] });

    const merged = fold({ ledgers: [a, b] });

    expect(merged.entries.map((entry) => entry.artifactId)).toEqual(["a-new", "b-mid", "a-old"]);
  });

  /** Two passes can finish inside the same millisecond, so the tie-break has to be deterministic. */
  it("breaks a shared instant by artifact id, descending", () => {
    const a = ledgerOf({ entries: [row({ artifactId: "aaa", createdAtIso: "2026-09-16T01:00:00.000Z" })] });
    const b = ledgerOf({ entries: [row({ artifactId: "zzz", createdAtIso: "2026-09-16T01:00:00.000Z" })] });

    expect(fold({ ledgers: [a, b] }).entries.map((entry) => entry.artifactId)).toEqual(["zzz", "aaa"]);
  });

  /**
   * The fail-closed count must SUM. A checkout whose records could not capture a tree has to keep costing
   * what it costs even when another checkout answered cleanly — otherwise widening the read would turn a
   * refusal into a pass.
   */
  it("sums the fail-closed count over checkouts that recorded work on this branch", () => {
    const spoke: BranchLedger = {
      entries: [row({ artifactId: "a", createdAtIso: "2026-09-16T01:00:00.000Z" })],
      unattributed: 2,
      unknowable: 3,
      unplaceable: [],
    };

    const merged = fold({ ledgers: [ledgerOf({ entries: [] }), spoke] });

    expect(merged.unknowable).toBe(3);
    expect(merged.unattributed).toBe(2);
  });

  /**
   * The measured regression: a worktree that never touched this branch carries unplaceable history, and
   * before this bound 5 such records refused a pull request whose own loop was complete.
   */
  it("ignores the fail-closed count of a checkout that recorded NOTHING on this branch", () => {
    const silent: BranchLedger = {
      entries: [],
      unattributed: 9,
      unknowable: 5,
      unplaceable: [unplaceable({ artifactId: "elsewhere" })],
    };
    const spoke: BranchLedger = {
      entries: [row({ artifactId: "a", createdAtIso: "2026-09-16T01:00:00.000Z" })],
      unattributed: 0,
      unknowable: 0,
      unplaceable: [],
    };

    expect(fold({ ledgers: [silent, spoke] }).unknowable).toBe(0);
    // And names none of it: the refusal lists exactly the records the count included.
    expect(fold({ ledgers: [silent, spoke] }).unplaceable).toEqual([]);
  });

  /**
   * The bound on that bound, and the reason this is not a loosening. The OLD reader consulted exactly one
   * checkout — the presser's — and failed closed on its `unknowable`. If that count could be dropped for
   * holding no row, a pull request the old code refused would pass now.
   */
  it("keeps the fail-closed count of the verb's OWN checkout even when it recorded nothing on this branch", () => {
    const own: BranchLedger = {
      entries: [],
      unattributed: 0,
      unknowable: 1,
      unplaceable: [unplaceable({ artifactId: "own-no-tree" })],
    };
    const spoke: BranchLedger = {
      entries: [row({ artifactId: "a", createdAtIso: "2026-09-16T01:00:00.000Z" })],
      unattributed: 0,
      unknowable: 0,
      unplaceable: [],
    };

    const merged = unionLedger({
      ledgers: [
        { alwaysCount: true, ledger: own },
        { alwaysCount: false, ledger: spoke },
      ],
    });

    expect(merged.unknowable).toBe(1);
    expect(merged.unplaceable.map((record) => record.artifactId)).toEqual(["own-no-tree"]);
  });
});

/** One no-tree record, as `ledgerForBranch` lists it. */
function unplaceable({ artifactId }: { artifactId: string }): UnplaceableRecord {
  return {
    artifactId,
    createdAtIso: "2026-09-27T13:55:03.688Z",
    mode: "plan",
    pass: "p2",
    propertyId: undefined,
    repoRoot: "/w/a-link",
    superseded: undefined,
    verdict: "READY",
  };
}

/**
 * The refusal used to say only HOW MANY, so the session holding the pull request could not find the artifact id to act on
 * and reached for `SLOPWEAVER_ALLOW_UNREVIEWED` instead.
 */
describe("incompleteScanReason on a no-tree record", () => {
  const scan = { records: [], unreadable: 0, withoutSidecar: 0 };
  const receipts: FallbackReceiptScan = {
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
  const judged = { branch: "feature", repoRoots: new Set(["/w/a-link"]) };

  it("names each unretired record, its checkout and the verb that retires it", () => {
    const ledger: BranchLedger = {
      entries: [],
      unattributed: 1,
      unknowable: 1,
      unplaceable: [unplaceable({ artifactId: "b44980e5" })],
    };
    expect(incompleteScanReason({ ...judged, ledger, receipts, scan })).toBe(
      "1 recorded pass(es) could not capture a tree at all, so nothing is known about what they described: " +
        "b44980e5 (p2 READY, 2026-09-27T13:55:03.688Z, in /w/a-link). Once a later pass of the same kind on this " +
        "branch has captured a tree, retire each with " +
        "`slopweaver codex supersede --artifact <id> --reason <text> --repo <its checkout>`",
    );
  });

  it("reads a checkout whose only no-tree record is retired as complete", () => {
    const retired = {
      ...unplaceable({ artifactId: "b44980e5" }),
      superseded: {
        artifactId: "b44980e5",
        atIso: "2026-09-30T03:00:00.000Z",
        branch: "feature",
        kind: "no-tree",
        mode: "plan",
        pass: "p2",
        reason: "p2 224c5d1c re-planned on a captured tree",
        replacedBy: "224c5d1c",
      },
    } satisfies UnplaceableRecord;
    const ledger: BranchLedger = { entries: [], unattributed: 1, unknowable: 0, unplaceable: [retired] };
    expect(incompleteScanReason({ ...judged, ledger, receipts, scan })).toBeUndefined();
  });
});
