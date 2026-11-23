/**
 * The review refusal that says no review is current names every BROKEN review that drifted from the tree with no
 * later CLEAN under its property, so a waiver of it says what it lands over. Diagnostic only: no verdict moves.
 */
import { describe, expect, it } from "vitest";

import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { ledgerForBranch, loopFailures } from "../../../../codex/ledger.js";
import type { Supersession } from "../../../../codex/supersession.js";
import type { CodexArtifactRecord, CodexPassTree } from "../../../../codex/types.js";
import { anyPassRecord, HEAD, OTHER_HEAD, planRecord, REPO, treeOn } from "./fixtures.js";

const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
/** A tree the current fingerprint has since moved away from — what makes a pass STALE. */
const beforeTheWork = treeOn({ branch: "feature", headSha: OTHER_HEAD, patch: "" });
const PLANNED = planRecord({ pass: "p2", tree: beforeTheWork });
const NONE_CURRENT =
  "review pass(es) ran but none is both current and conclusive — each either describes a tree that has since " +
  "changed, has provenance that could not be established, or produced no verdict a review can give";

/** A STALE review row on the branch, answering `property` with `verdict` at `createdAtIso`. */
function review({
  artifactId,
  createdAtIso,
  pass = "r1",
  property,
  tree = beforeTheWork,
  verdict,
}: {
  artifactId: string;
  createdAtIso: string;
  pass?: "r1" | "r2";
  property: string;
  tree?: CodexPassTree;
  verdict: "BROKEN" | "CLEAN";
}): CodexArtifactRecord {
  const base = anyPassRecord({ artifactId, pass, tree, verdict });
  if (base.scope.mode !== "review" || base.outcome.kind !== "answered" || !("propertyId" in base.outcome.answer)) {
    throw new Error("anyPassRecord built a review pass that is not an answered review");
  }
  return {
    ...base,
    createdAtIso,
    outcome: { ...base.outcome, answer: { ...base.outcome.answer, propertyId: property } },
    scope: { ...base.scope, property: { id: property, statement: "a falsifiable claim" } },
  };
}

/** The floor's failures over `records`, with `retired` superseded. */
function failuresOf({
  records,
  retired = new Map(),
}: {
  records: readonly CodexArtifactRecord[];
  retired?: ReadonlyMap<string, Supersession>;
}): readonly string[] {
  return loopFailures({
    entries: ledgerForBranch({ branch: "feature", now, records, repoRoot: REPO, supersessions: retired }).entries,
  });
}

/** The supersession retiring `artifactId`. */
function retiring({ artifactId }: { artifactId: string }): ReadonlyMap<string, Supersession> {
  return new Map([
    [
      artifactId,
      { artifactId, atIso: "2026-09-12T12:00:00.000Z", propertyId: "p", reason: "retired", replacedBy: "x" },
    ],
  ]);
}

const DRIFT = " — the newest, r2 (switch-integrity), is STALE: the committed tree changed after the pass read it";

describe("the none-current review refusal names drifted BROKEN reviews", () => {
  it("names both STALE BROKEN passes on one property, newest first, when nothing answered them", () => {
    const records = [
      PLANNED,
      review({
        artifactId: "a",
        createdAtIso: "2026-08-03T00:00:00.000Z",
        property: "switch-integrity",
        verdict: "BROKEN",
      }),
      review({
        artifactId: "b",
        createdAtIso: "2026-08-04T00:00:00.000Z",
        pass: "r2",
        property: "switch-integrity",
        verdict: "BROKEN",
      }),
    ];

    expect(failuresOf({ records })).toEqual([
      `2 ${NONE_CURRENT}${DRIFT} (HEAD now ${HEAD.slice(0, 12)})` +
        " — BROKEN with no later CLEAN under the same property: r2/switch-integrity (b) is STALE; " +
        "r1/switch-integrity (a) is STALE",
    ]);
  });

  it("tells two rows of one pass on one property apart by their artifact ids", () => {
    const records = [
      PLANNED,
      review({
        artifactId: "codex-run",
        createdAtIso: "2026-08-03T00:00:00.000Z",
        pass: "r2",
        property: "no-credential-echo",
        verdict: "BROKEN",
      }),
      review({
        artifactId: "re-run",
        createdAtIso: "2026-08-04T00:00:00.000Z",
        pass: "r2",
        property: "no-credential-echo",
        verdict: "BROKEN",
      }),
    ];

    expect(failuresOf({ records })[0]).toMatch(
      / — BROKEN with no later CLEAN under the same property: r2\/no-credential-echo \(re-run\) is STALE; r2\/no-credential-echo \(codex-run\) is STALE$/,
    );
  });

  it("names an UNKNOWN BROKEN pass as UNKNOWN", () => {
    const { treeSha: _dropped, ...withoutSidecar } = treeOn({ branch: "feature", headSha: HEAD, patch: "" });
    const records = [
      PLANNED,
      review({
        artifactId: "a",
        createdAtIso: "2026-08-03T00:00:00.000Z",
        property: "no-credential-echo",
        tree: withoutSidecar,
        verdict: "BROKEN",
      }),
    ];

    expect(failuresOf({ records })[0]).toMatch(
      / — BROKEN with no later CLEAN under the same property: r1\/no-credential-echo \(a\) is UNKNOWN$/,
    );
  });

  it("names nothing when a later CLEAN, itself stale, answers the same property — and the refusal stands", () => {
    const records = [
      PLANNED,
      review({
        artifactId: "a",
        createdAtIso: "2026-08-03T00:00:00.000Z",
        property: "switch-integrity",
        verdict: "BROKEN",
      }),
      review({
        artifactId: "b",
        createdAtIso: "2026-08-04T00:00:00.000Z",
        pass: "r2",
        property: "switch-integrity",
        verdict: "CLEAN",
      }),
    ];

    expect(failuresOf({ records })).toEqual([`2 ${NONE_CURRENT}${DRIFT} (HEAD now ${HEAD.slice(0, 12)})`]);
  });

  it("still names it when the later CLEAN answers a different property", () => {
    const records = [
      PLANNED,
      review({
        artifactId: "a",
        createdAtIso: "2026-08-03T00:00:00.000Z",
        property: "switch-integrity",
        verdict: "BROKEN",
      }),
      review({
        artifactId: "b",
        createdAtIso: "2026-08-04T00:00:00.000Z",
        pass: "r2",
        property: "other",
        verdict: "CLEAN",
      }),
    ];

    expect(failuresOf({ records })[0]).toMatch(
      / — BROKEN with no later CLEAN under the same property: r1\/switch-integrity \(a\) is STALE$/,
    );
  });

  it("still names it when the CLEAN under its property came BEFORE it", () => {
    const records = [
      PLANNED,
      review({
        artifactId: "a",
        createdAtIso: "2026-08-03T00:00:00.000Z",
        property: "switch-integrity",
        verdict: "CLEAN",
      }),
      review({
        artifactId: "b",
        createdAtIso: "2026-08-04T00:00:00.000Z",
        pass: "r2",
        property: "switch-integrity",
        verdict: "BROKEN",
      }),
    ];

    expect(failuresOf({ records })[0]).toMatch(
      / — BROKEN with no later CLEAN under the same property: r2\/switch-integrity \(b\) is STALE$/,
    );
  });

  it("still names it when the later CLEAN under its property is superseded", () => {
    const records = [
      PLANNED,
      review({
        artifactId: "a",
        createdAtIso: "2026-08-03T00:00:00.000Z",
        property: "switch-integrity",
        verdict: "BROKEN",
      }),
      review({
        artifactId: "b",
        createdAtIso: "2026-08-04T00:00:00.000Z",
        pass: "r2",
        property: "switch-integrity",
        verdict: "CLEAN",
      }),
    ];

    expect(failuresOf({ records, retired: retiring({ artifactId: "b" }) })[0]).toMatch(
      / — BROKEN with no later CLEAN under the same property: r1\/switch-integrity \(a\) is STALE$/,
    );
  });

  it("never names a superseded BROKEN pass", () => {
    const records = [
      PLANNED,
      review({
        artifactId: "a",
        createdAtIso: "2026-08-03T00:00:00.000Z",
        property: "switch-integrity",
        verdict: "BROKEN",
      }),
    ];

    expect(failuresOf({ records, retired: retiring({ artifactId: "a" }) })).toEqual([
      `1 ${NONE_CURRENT} — the newest, r1 (switch-integrity), is STALE: the committed tree changed after the pass ` +
        `read it (HEAD now ${HEAD.slice(0, 12)})`,
    ]);
  });
});
