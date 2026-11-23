/**
 * `renderLedger`: every loop pass is listed, the ones that never ran included, with the missing passes stated
 * as a sentence, the outcome context on a non-clean row, and a corrupt record told apart from a legacy one.
 */
import { describe, expect, it } from "vitest";

import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { ledgerForBranch } from "../../../../codex/ledger.js";
import { LOOP_PASSES, renderLedger } from "../../../../codex/ledgerRender.js";
import { anyPassRecord, HEAD, planRecord, REPO, treeOn } from "./fixtures.js";

describe("renderLedger", () => {
  it("has at least one entry in LOOP_PASSES, so the guards below are not vacuously green", () => {
    expect(LOOP_PASSES.length).toBeGreaterThan(0);
  });

  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
  const onBranch = treeOn({ branch: "feature", headSha: HEAD, patch: "" });

  /**
   * The whole reason this renderer exists. A table of what DID happen cannot show an absence, and an absence
   * — a skipped plan and three skipped reviews — is the failure the ledger was built for.
   */
  it("lists every loop pass, including the ones that never ran", () => {
    const lines = renderLedger({
      branch: "feature",
      entries: [],
      headSha: HEAD,
      withoutSidecar: 0,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
    });

    LOOP_PASSES.forEach((pass) => {
      expect(lines.some((line) => line.includes(`  ${pass}  NOT RUN`))).toBe(true);
    });
  });

  it("states the missing passes as a sentence, not only as blank rows", () => {
    const { entries } = ledgerForBranch({
      repoRoot: REPO,
      branch: "feature",
      now,
      records: [planRecord({ pass: "p1", tree: onBranch })],
    });

    const lines = renderLedger({
      branch: "feature",
      entries,
      headSha: HEAD,
      withoutSidecar: 0,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
    });

    expect(lines).toContain("NOT RUN: p2, p3, r1, r2, r3 — 5 of 6 passes never ran on this branch");
  });

  it("says so plainly when the loop is complete", () => {
    const records = LOOP_PASSES.map((pass) => anyPassRecord({ pass, tree: onBranch }));
    const { entries } = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records });

    expect(
      renderLedger({
        branch: "feature",
        entries,
        headSha: HEAD,
        withoutSidecar: 0,
        unattributed: 0,
        unplaceable: [],
        unreadable: 0,
      }),
    ).toContain("every pass in the loop has run");
  });

  /**
   * A permanent alarming count is one nobody reads. Legacy passes are ordinary; a corrupt record is not.
   */
  it("appends the composed outcome context to a non-clean row", () => {
    const { entries } = ledgerForBranch({
      repoRoot: REPO,
      branch: "feature",
      now,
      records: [planRecord({ pass: "p1", tree: onBranch, verdict: "BLOCKED" })],
    });

    const lines = renderLedger({
      branch: "feature",
      entries,
      headSha: HEAD,
      withoutSidecar: 0,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
    });

    expect(lines.some((line) => line.endsWith("— answer recorded 0 blockers"))).toBe(true);
  });

  it("adds no context suffix to a clean first-try row", () => {
    const { entries } = ledgerForBranch({
      repoRoot: REPO,
      branch: "feature",
      now,
      records: [planRecord({ pass: "p1", tree: onBranch, verdict: "READY" })],
    });

    const lines = renderLedger({
      branch: "feature",
      entries,
      headSha: HEAD,
      withoutSidecar: 0,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
    });

    expect(lines.some((line) => line.includes("  p1  ") && line.includes("—"))).toBe(false);
  });

  it("separates a corrupt record from a pass that merely predates provenance", () => {
    const lines = renderLedger({
      branch: "feature",
      entries: [],
      headSha: HEAD,
      withoutSidecar: 242,
      unattributed: 0,
      unplaceable: [],
      unreadable: 3,
    });

    expect(lines.some((line) => line.startsWith("CORRUPT: 3 finished pass(es)"))).toBe(true);
    expect(lines.some((line) => line.startsWith("(242 older pass(es) predate"))).toBe(true);
  });
});
