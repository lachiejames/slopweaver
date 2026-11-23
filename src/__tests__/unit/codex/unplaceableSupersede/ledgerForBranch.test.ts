/**
 * Retiring a pass that recorded NO TREE (an owner ruling: a supersede verb, explicit and journalled, the gate
 * fail-closed by default).
 *
 * The shape under test is a measured one: a plan READY with no tree, a later placed p2 READY, and a pull request
 * unable to land without a hatch because nothing could retire the first.
 */

import { describe, expect, it } from "vitest";

import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { ledgerForBranch } from "../../../../codex/ledger.js";
import { renderLedger } from "../../../../codex/ledgerRender.js";
import { type Supersession, unplaceableSupersedeRefusal } from "../../../../codex/supersession.js";
import type { CodexArtifactRecord, CodexPassTree } from "../../../../codex/types.js";
import { HEAD, LATER_PLAN, NO_TREE_AT, NO_TREE_PLAN, REPO } from "./harness.js";

describe("ledgerForBranch with a retired no-tree record", () => {
  const tree: CodexPassTree = (() => {
    const fp = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
    return { branch: "feature", dirtyBytes: fp.dirtyBytes, fingerprint: fp.digest, headSha: HEAD, treeSha: fp.treeSha };
  })();
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });

  /** A plan record, with or without a tree. */
  function plan({ artifactId, withTree }: { artifactId: string; withTree: boolean }): CodexArtifactRecord {
    return {
      artifactId,
      attempts: [],
      bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
      createdAtIso: NO_TREE_AT,
      observedElapsedMs: 10,
      outcome: {
        answer: { blockers: [], bodyMarkdown: "", summary: "", verdict: "READY" },
        kind: "answered",
        rawFinalResponse: "{}",
      },
      repoRoot: REPO,
      requestedApprovalPolicy: "never",
      requestedModel: "m",
      requestedNetworkAccess: true,
      requestedReasoningEffort: "xhigh",
      requestedSandboxMode: "workspace-write",
      requestedWebSearch: true,
      requestedWritableRoots: [],
      schemaVersion: 1,
      scope: { mode: "plan", pass: "p2", promptBytes: 1, promptSha256: "abc" },
      ...(withTree ? { tree } : {}),
    };
  }

  const row: Supersession = {
    artifactId: "b44980e5",
    atIso: "2026-09-30T03:00:00.000Z",
    branch: "feature",
    kind: "no-tree",
    mode: "plan",
    pass: "p2",
    reason: "224c5d1c re-planned on a captured tree",
    replacedBy: "224c5d1c",
  };

  /** A wording row for the same id, which the verb never writes; a legacy or hand-written one proves nothing. */
  const wordingRow: Supersession = {
    artifactId: "b44980e5",
    atIso: "2026-09-30T03:00:00.000Z",
    propertyId: "r1-01",
    reason: "hand-written",
    replacedBy: "224c5d1c",
  };

  it("lists an unretired no-tree record and counts it unknowable", () => {
    const ledger = ledgerForBranch({
      branch: "feature",
      now,
      records: [plan({ artifactId: "b44980e5", withTree: false })],
      repoRoot: REPO,
    });
    expect(ledger.unknowable).toBe(1);
    expect(ledger.unplaceable.map((record) => [record.artifactId, record.pass, record.verdict])).toEqual([
      ["b44980e5", "p2", "READY"],
    ]);
  });

  it("stops counting it once retired, and keeps it listed and unattributed", () => {
    const ledger = ledgerForBranch({
      branch: "feature",
      now,
      records: [plan({ artifactId: "b44980e5", withTree: false })],
      repoRoot: REPO,
      supersessions: new Map([["b44980e5", row]]),
    });
    expect(ledger.unknowable).toBe(0);
    expect(ledger.unattributed).toBe(1);
    expect(ledger.unplaceable[0]!.superseded).toEqual(row);
  });

  /** The forgery the fallback review built: a row keyed by the id retired the record with no replacement at all. */
  it("keeps counting it beside a WORDING row for the same id", () => {
    const ledger = ledgerForBranch({
      branch: "feature",
      now,
      records: [plan({ artifactId: "b44980e5", withTree: false })],
      repoRoot: REPO,
      supersessions: new Map([["b44980e5", wordingRow]]),
    });
    expect([ledger.unknowable, ledger.unplaceable[0]!.superseded]).toEqual([1, undefined]);
  });

  /** The record names no branch, so a replacement proved it stale for the branch it stood on and no other. */
  it("keeps counting it when judged for a branch other than the row's", () => {
    const ledger = ledgerForBranch({
      branch: "other",
      now,
      records: [plan({ artifactId: "b44980e5", withTree: false })],
      repoRoot: REPO,
      supersessions: new Map([["b44980e5", row]]),
    });
    expect([ledger.unknowable, ledger.unplaceable[0]!.superseded]).toEqual([1, undefined]);
  });

  it("never lets a no-tree row retire a PLACED pass under the same id", () => {
    const ledger = ledgerForBranch({
      branch: "feature",
      now,
      records: [plan({ artifactId: "b44980e5", withTree: true })],
      repoRoot: REPO,
      supersessions: new Map([["b44980e5", row]]),
    });
    expect(ledger.entries.map((each) => [each.artifactId, each.superseded])).toEqual([["b44980e5", undefined]]);
  });

  it("refuses a second retirement when the standing row was taken on another branch", () => {
    expect(
      unplaceableSupersedeRefusal({
        alreadyRetired: new Set(["b44980e5"]),
        artifactId: "b44980e5",
        entries: [LATER_PLAN],
        unplaceable: [NO_TREE_PLAN],
      }),
    ).toBe(
      "b44980e5 already carries a retirement row that does not retire it on this branch — a no-tree row holds " +
        "only for the branch its replacement stood on, and one row per record is the limit, so it keeps counting here",
    );
  });

  it("prints an unretired record with the verb, and a retired one with its reason", () => {
    const base = { branch: "feature", entries: [], headSha: HEAD, unattributed: 1, unreadable: 0, withoutSidecar: 0 };
    expect(renderLedger({ ...base, unplaceable: [NO_TREE_PLAN] })).toContain(
      "NO TREE: b44980e5  p2  READY  2026-09-27T13:55:03.688Z — blocks --check and landing from this checkout; " +
        "once a later plan on this branch captured a tree: " +
        "slopweaver codex supersede --artifact b44980e5 --reason <text>",
    );
    const retired = renderLedger({ ...base, unplaceable: [{ ...NO_TREE_PLAN, superseded: row }] });
    expect(retired).toContain("        SUPERSEDED by 224c5d1c on 2026-09-30T03:00:00.000Z");
    expect(retired).toContain("        reason: 224c5d1c re-planned on a captured tree");
  });
});
