/**
 * The ledger cannot under-report: a recorded pass that captured no branch is counted rather than dropped, and
 * the rendered ledger warns that a NOT RUN row may then be wrong.
 */
import { describe, expect, it } from "vitest";

import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { ledgerForBranch } from "../../../../codex/ledger.js";
import { renderLedger } from "../../../../codex/ledgerRender.js";
import { HEAD, planRecord, REPO } from "./fixtures.js";

/**
 * Both directions of "the ledger must never claim less work, or more freshness, than it established".
 *
 * Found by a Codex review of the ledger commit, asking exactly that. Both were real.
 */
describe("the ledger cannot under-report", () => {
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });

  /**
   * Tree capture is best-effort, so a pass CAN run and be recorded with no tree — a repository whose patch
   * exceeds the git buffer, for instance. The branch filter used to drop those records entirely, printing
   * NOT RUN for work that actually happened, with nothing anywhere saying so.
   */
  it("counts a recorded pass that captured no branch instead of dropping it", () => {
    const records = [planRecord({ pass: "p1", tree: undefined })];

    const ledger = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records });

    expect(ledger.entries).toEqual([]);
    expect(ledger.unattributed).toBe(1);
  });

  it("warns that a NOT RUN row may be wrong when passes could not be attributed", () => {
    const lines = renderLedger({
      branch: "feature",
      entries: [],
      headSha: HEAD,
      withoutSidecar: 0,
      unattributed: 2,
      unplaceable: [],
      unreadable: 0,
    });

    expect(
      lines.some(
        (line) => line === "UNATTRIBUTED: 2 recorded pass(es) captured no branch, so a NOT RUN above may be wrong",
      ),
    ).toBe(true);
  });

  it("stays silent about attribution when every pass carries a branch", () => {
    const lines = renderLedger({
      branch: "feature",
      entries: [],
      headSha: HEAD,
      withoutSidecar: 0,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
    });

    expect(lines.some((line) => line.startsWith("UNATTRIBUTED"))).toBe(false);
  });
});
