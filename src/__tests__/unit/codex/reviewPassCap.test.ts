/**
 * The owner's two-pass review cap: what one review PASS is, when a review may still run, and
 * when a CURRENT `BROKEN` stops being a floor failure and becomes a leftover the pull request body must name.
 * A baseline-bump witness counts in its own lane, two diffs of its own, and neither lane spends the other's.
 */
import { describe, expect, it } from "vitest";

import { assessCodexLoop, type LedgerEntry } from "../../../codex/ledger.js";
import { LANE_PASS_CAP, REVIEW_PASS_CAP, reviewCapDecision, reviewedDiffs } from "../../../codex/reviewPassCap.js";
import { ledgerRow as row } from "./ledgerEntryFixture.js";

/** A STALE READY plan, so the plan half is met and a case judges only the review half. */
const PLAN = row({
  artifactId: "plan-1",
  createdAtIso: "2026-11-11T00:00:00.000Z",
  diffSha256: undefined,
  freshness: { kind: "stale", reason: "the tree moved" },
  mode: "plan",
  pass: "p2",
  propertyId: undefined,
  verdict: "READY",
});

const DIGEST = "e".repeat(64);

/** A Codex r3 witness row for a synthetic bump digest; a case overrides the diff and the fields it is about. */
const witness = (over: Partial<LedgerEntry> = {}): LedgerEntry =>
  row({
    artifactId: "witness-1",
    diffSha256: "w",
    pass: "r3",
    propertyId: `baseline-bump-${DIGEST}`,
    propertyStatement: `Ratchet bump ${DIGEST}: each loosening listed is JUSTIFIED`,
    ...over,
  });

describe("reviewedDiffs", () => {
  it("counts one pass per distinct reviewed diff, oldest first — a fan-out and r1/r2/r3 over one diff are one", () => {
    const entries = [
      row({ artifactId: "c", diffSha256: "b", pass: "r2" }),
      row({ artifactId: "b", diffSha256: "a", pass: "r3", propertyId: "r3-01" }),
      row({ artifactId: "a", diffSha256: "a", pass: "r1" }),
    ];
    expect(reviewedDiffs({ entries, lane: "general" })).toEqual(["a", "b"]);
  });

  it("spends no pass on a review that reached no verdict, nor on a plan", () => {
    const entries = [
      row({ artifactId: "n", diffSha256: "b", verdict: "NO_VERDICT:bound" }),
      row({ artifactId: "f", diffSha256: "c", verdict: "FATAL" }),
      PLAN,
      row({ artifactId: "a", diffSha256: "a" }),
    ];
    expect(reviewedDiffs({ entries, lane: "general" })).toEqual(["a"]);
  });

  it("still counts a superseded row and a Claude fallback receipt — a retirement spends nothing back", () => {
    const entries = [
      row({ artifactId: "claude", diffSha256: "b", provider: "claude-code" }),
      row({
        artifactId: "retired",
        diffSha256: "a",
        superseded: {
          artifactId: "retired",
          atIso: "2026-11-11T02:00:00.000Z",
          propertyId: "r1-01",
          reason: "the wording was wrong",
          replacedBy: "claude",
        },
        verdict: "BROKEN",
      }),
    ];
    expect(reviewedDiffs({ entries, lane: "general" })).toEqual(["a", "b"]);
  });

  it("counts nothing on an empty ledger", () => {
    expect(reviewedDiffs({ entries: [], lane: "general" })).toEqual([]);
  });
});

describe("reviewedDiffs by lane", () => {
  it("keeps a witness-only diff out of the general count and in the witness count", () => {
    const entries = [witness(), row({ artifactId: "b", diffSha256: "b" }), row()];
    expect(reviewedDiffs({ entries, lane: "general" })).toEqual(["a", "b"]);
    expect(reviewedDiffs({ entries, lane: "baseline-bump-witness" })).toEqual(["w"]);
  });

  it("leaves a diff in the general count when a general sibling of the fan-out reviewed it too", () => {
    const entries = [witness({ diffSha256: "a" }), row()];
    expect(reviewedDiffs({ entries, lane: "general" })).toEqual(["a"]);
    expect(reviewedDiffs({ entries, lane: "baseline-bump-witness" })).toEqual(["a"]);
  });

  it("counts a witness-looking row whose statement is not a witness claim as general", () => {
    const entries = [witness({ propertyStatement: "every function in this diff is correct" })];
    expect(reviewedDiffs({ entries, lane: "general" })).toEqual(["w"]);
    expect(reviewedDiffs({ entries, lane: "baseline-bump-witness" })).toEqual([]);
  });

  it("counts a superseded witness and spends nothing on one that reached no verdict", () => {
    const entries = [
      witness({ artifactId: "fatal", diffSha256: "x", verdict: "FATAL" }),
      witness({ artifactId: "nv", diffSha256: "y", verdict: "NO_VERDICT:bound" }),
      witness({
        superseded: {
          artifactId: "witness-1",
          atIso: "2026-11-11T02:00:00.000Z",
          propertyId: `baseline-bump-${DIGEST}`,
          reason: "the wording was wrong",
          replacedBy: "witness-2",
        },
        verdict: "BROKEN",
      }),
    ];
    expect(reviewedDiffs({ entries, lane: "baseline-bump-witness" })).toEqual(["w"]);
  });
});

describe("reviewCapDecision", () => {
  it("is the owner's number, two", () => {
    expect(REVIEW_PASS_CAP).toBe(2);
  });

  it("allows the first pass on a branch with no review", () => {
    expect(reviewCapDecision({ candidateDiffSha256: "a", entries: [PLAN], lane: "general" })).toEqual({
      kind: "allowed",
      pass: 1,
    });
  });

  it("allows the second pass over a new diff", () => {
    expect(reviewCapDecision({ candidateDiffSha256: "b", entries: [row()], lane: "general" })).toEqual({
      kind: "allowed",
      pass: 2,
    });
  });

  it("allows another property over a diff already reviewed, which is part of that pass", () => {
    const entries = [row({ artifactId: "b", diffSha256: "b" }), row()];
    expect(reviewCapDecision({ candidateDiffSha256: "a", entries, lane: "general" })).toEqual({
      kind: "allowed",
      pass: 1,
    });
    expect(reviewCapDecision({ candidateDiffSha256: "b", entries, lane: "general" })).toEqual({
      kind: "allowed",
      pass: 2,
    });
  });

  it("refuses a third diff once two have been reviewed, naming both", () => {
    const entries = [row({ artifactId: "b", diffSha256: "b" }), row()];
    expect(reviewCapDecision({ candidateDiffSha256: "c", entries, lane: "general" })).toEqual({
      kind: "capped",
      reviewed: ["a", "b"],
    });
  });
});

describe("reviewCapDecision in the witness lane", () => {
  it("gives each lane two diffs of its own", () => {
    expect(LANE_PASS_CAP).toEqual({ "baseline-bump-witness": 2, general: 2 });
  });

  it("allows a first witness on a branch whose two general passes are spent", () => {
    const entries = [row({ artifactId: "b", diffSha256: "b" }), row()];
    expect(reviewCapDecision({ candidateDiffSha256: "c", entries, lane: "baseline-bump-witness" })).toEqual({
      kind: "allowed",
      pass: 1,
    });
  });

  it("gives a general pass back nothing however many witness diffs stand", () => {
    const entries = [witness({ artifactId: "w2", diffSha256: "w2" }), witness(), row({ diffSha256: "b" }), row()];
    expect(reviewCapDecision({ candidateDiffSha256: "c", entries, lane: "general" })).toEqual({
      kind: "capped",
      reviewed: ["a", "b"],
    });
  });

  it("keeps a witness diff already taken at its own ordinal, and refuses a third witness diff", () => {
    const entries = [witness({ artifactId: "w2", diffSha256: "w2" }), witness()];
    expect(reviewCapDecision({ candidateDiffSha256: "w", entries, lane: "baseline-bump-witness" })).toEqual({
      kind: "allowed",
      pass: 1,
    });
    expect(reviewCapDecision({ candidateDiffSha256: "w3", entries, lane: "baseline-bump-witness" })).toEqual({
      kind: "capped",
      reviewed: ["w", "w2"],
    });
  });
});

describe("assessCodexLoop under the cap", () => {
  it("refuses a CURRENT BROKEN after the first pass, sending the session to its second", () => {
    const entries = [row({ verdict: "BROKEN" }), PLAN];
    expect(assessCodexLoop({ entries })).toEqual({
      failures: [
        "r1 is CURRENT and BROKEN (r1-01) — fix it, then take the second and last review pass over the fixed diff",
      ],
      leftovers: [],
    });
  });

  it("turns a CURRENT BROKEN after the second pass into a leftover rather than a failure", () => {
    const entries = [
      row({
        artifactId: "second",
        diffSha256: "b",
        pass: "r2",
        propertyId: "r2-08",
        reviewSummary: "loses a write",
        verdict: "BROKEN",
      }),
      row({ artifactId: "first", freshness: { kind: "stale", reason: "the diff moved" }, verdict: "BROKEN" }),
      PLAN,
    ];
    expect(assessCodexLoop({ entries })).toEqual({
      failures: [],
      leftovers: [{ artifactId: "second", pass: "r2", propertyId: "r2-08", summary: "loses a write" }],
    });
  });

  it("still refuses a branch with no plan, past the cap or not — only BROKEN reviews become leftovers", () => {
    const entries = [row({ artifactId: "second", diffSha256: "b", verdict: "BROKEN" }), row()];
    const assessed = assessCodexLoop({ entries });
    expect(assessed.failures).toEqual([
      "no planning pass has run on this branch — nothing planned the work before it was written",
    ]);
    expect(assessed.leftovers.map((leftover) => leftover.artifactId)).toEqual(["second"]);
  });
});
