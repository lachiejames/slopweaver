/**
 * `ledgerForBranch`: which recorded passes belong to a branch, newest first, how a pass with no readable tree
 * is counted rather than dropped, and the outcome context composed onto each entry.
 */
import { describe, expect, it } from "vitest";

import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { ledgerForBranch } from "../../../../codex/ledger.js";
import type { CodexArtifactRecord } from "../../../../codex/types.js";
import { HEAD, planRecord, REPO, treeOn } from "./fixtures.js";

describe("ledgerForBranch", () => {
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
  const onBranch = treeOn({ branch: "feature", headSha: HEAD, patch: "" });

  it("returns only passes recorded on that branch", () => {
    const records = [
      planRecord({ pass: "p1", tree: onBranch }),
      planRecord({ pass: "p2", tree: treeOn({ branch: "other", headSha: HEAD, patch: "" }) }),
    ];

    expect(ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records }).entries.map((e) => e.pass)).toEqual([
      "p1",
    ]);
  });

  /**
   * A detached-HEAD pass is in neither `entries` nor, before this, `unattributed` — so it vanished exactly as
   * the no-`tree` case once did. Found by a Codex review, once the landing guard began FAILING CLOSED on this
   * count: a newer BLOCKED plan recorded on a detached HEAD would have left the floor reading clean.
   */
  it("counts a detached-HEAD pass as unattributed rather than letting it vanish", () => {
    const records = [planRecord({ pass: "p1", tree: treeOn({ branch: null, headSha: HEAD, patch: "" }) })];
    const ledger = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records });

    expect(ledger.entries).toEqual([]);
    expect(ledger.unattributed).toBe(1);
  });

  /**
   * The two counts differ on purpose, and this is the case that forced it: a `codex review` run DURING a
   * rebase records a good pass on a detached HEAD. Folding that into the fail-closed count left the checkout
   * permanently unable to land. Capture SUCCEEDING and saying "detached" is knowledge; capture FAILING is not.
   */
  it("reports a detached-HEAD pass as unattributed but NOT as unknowable", () => {
    const records = [planRecord({ pass: "p1", tree: treeOn({ branch: null, headSha: HEAD, patch: "" }) })];
    const ledger = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records });

    expect(ledger.unattributed).toBe(1);
    expect(ledger.unknowable).toBe(0);
  });

  /** A persisted `tree: null` is neither `undefined` nor carries a branch, so it fell out of BOTH counts. */
  it("counts a null tree as unknowable, not just an absent one", () => {
    const base = planRecord({ pass: "p1", tree: treeOn({ branch: "feature", headSha: HEAD, patch: "" }) });
    const nulled = { ...base, tree: null } as unknown as CodexArtifactRecord;
    const ledger = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records: [nulled] });

    expect(ledger.entries).toEqual([]);
    expect(ledger.unknowable).toBe(1);
  });

  /** An empty tree object: no branch AND no provenance, so nothing about it is known. */
  it("counts an empty tree object as unknowable, not merely unattributed", () => {
    const base = planRecord({ pass: "p1", tree: treeOn({ branch: "feature", headSha: HEAD, patch: "" }) });
    const empty = { ...base, tree: {} } as unknown as CodexArtifactRecord;
    const ledger = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records: [empty] });

    expect(ledger.entries).toEqual([]);
    expect(ledger.unknowable).toBe(1);
  });

  /** And a tree carrying a branch but junk digests is equally unreadable. */
  it("counts a tree whose digests are malformed as unknowable", () => {
    const base = planRecord({ pass: "p1", tree: treeOn({ branch: "feature", headSha: HEAD, patch: "" }) });
    const junk = { ...base, tree: { branch: null, dirtyBytes: 0, fingerprint: "x", headSha: HEAD, treeSha: "y" } };
    const ledger = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records: [junk] });

    expect(ledger.unknowable).toBe(1);
  });

  it("counts a pass whose tree capture failed as BOTH, since nothing about it is known", () => {
    const ledger = ledgerForBranch({
      repoRoot: REPO,
      branch: "feature",
      now,
      records: [planRecord({ pass: "p1", tree: undefined })],
    });

    expect(ledger.unattributed).toBe(1);
    expect(ledger.unknowable).toBe(1);
  });

  it("still counts a pass whose tree capture failed entirely", () => {
    const ledger = ledgerForBranch({
      repoRoot: REPO,
      branch: "feature",
      now,
      records: [planRecord({ pass: "p1", tree: undefined })],
    });

    expect(ledger.unattributed).toBe(1);
  });

  it("excludes a pass with no branch rather than attributing it to the query", () => {
    const records = [planRecord({ pass: "p1", tree: treeOn({ branch: null, headSha: HEAD, patch: "" }) })];

    expect(ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records }).entries).toEqual([]);
  });

  it("orders newest first", () => {
    const records = [
      planRecord({ createdAtIso: "2026-08-01T00:00:00.000Z", pass: "p1", tree: onBranch }),
      planRecord({ createdAtIso: "2026-08-02T00:00:00.000Z", pass: "p2", tree: onBranch }),
    ];

    expect(ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records }).entries.map((e) => e.pass)).toEqual([
      "p2",
      "p1",
    ]);
  });

  it("composes the outcome context onto each entry from its own record", () => {
    const records = [planRecord({ pass: "p1", tree: onBranch, verdict: "BLOCKED" })];

    const { entries } = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records });

    expect(entries.length).toBe(1);
    expect(entries[0]!.outcomeContext).toBe("answer recorded 0 blockers");
  });

  it("leaves a clean first-try entry's outcome context undefined", () => {
    const records = [planRecord({ pass: "p1", tree: onBranch, verdict: "READY" })];

    const { entries } = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records });

    // The COUNT first: `const [entry] = []` leaves `entry` undefined, so asserting only the field would pass
    // just as happily over a ledger that had dropped the record entirely. Caught by a Codex review.
    expect(entries.length).toBe(1);
    expect(entries[0]!.outcomeContext).toBeUndefined();
  });

  it("degrades rather than crashes on a legacy record scanPassRecords accepted with a field missing", () => {
    // `scanPassRecords` only checks that `outcome` is an object, so a shallow-decoded legacy record can
    // have `answer.blockers` genuinely absent at runtime. Found by adversarial review: this used to throw
    // reading `.length` and would have crashed the whole `codex status` / `codex status --check` command on
    // this ONE malformed row, before the unrelated CLEAN reviews on the branch were ever considered.
    const malformed = {
      ...planRecord({ pass: "p1", tree: onBranch }),
      outcome: { answer: { verdict: "BLOCKED" }, kind: "answered", rawFinalResponse: "{}" },
    } as unknown as CodexArtifactRecord;

    const { entries } = ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records: [malformed] });

    expect(entries.length).toBe(1);
    expect(entries[0]!.outcomeContext).toBe("outcome context unavailable — this record could not be formatted");
    expect(entries[0]!.verdict).toBe("BLOCKED");
  });
});
