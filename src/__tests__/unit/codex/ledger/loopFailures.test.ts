/**
 * `loopFailures`: the pairing floor refuses a branch on absence of evidence — no STALE READY plan, no current
 * conclusive review — never on a judgement of quality, names the cause when the newest pass reached no verdict,
 * and names a live Codex cap without ever lifting a refusal.
 */
import { describe, expect, it } from "vitest";

import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { type LedgerEntry, ledgerForBranch, loopFailures } from "../../../../codex/ledger.js";
import type { CodexQuotaEvidence } from "../../../../codex/quotaTypes.js";
import type { CodexArtifactRecord } from "../../../../codex/types.js";
import { anyPassRecord, HEAD, OTHER_HEAD, planRecord, REPO, treeOn } from "./fixtures.js";

/**
 * The gate's policy: refuse on absence of evidence, never on a judgement of quality.
 *
 * That line is what keeps this from becoming the em-dash rule — a check nobody can argue with is a check
 * nobody routes around.
 */
describe("loopFailures", () => {
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
  const onBranch = treeOn({ branch: "feature", headSha: HEAD, patch: "" });
  /** A tree the current fingerprint has since moved away from — what makes a pass STALE. */
  const beforeTheWork = treeOn({ branch: "feature", headSha: OTHER_HEAD, patch: "" });
  const NO_PLAN = "no planning pass has run on this branch — nothing planned the work before it was written";
  const NO_REVIEW = "no review pass has run on this branch — the diff has never been read by the second brain";

  function entriesFor({ records }: { records: readonly CodexArtifactRecord[] }): readonly LedgerEntry[] {
    return ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records }).entries;
  }

  /** The shape the whole rule exists to require: Codex planned, the tree moved, Codex reviewed what landed. */
  function pairedLoop(): readonly CodexArtifactRecord[] {
    return [planRecord({ pass: "p2", tree: beforeTheWork }), anyPassRecord({ pass: "r1", tree: onBranch })];
  }

  it("accepts a STALE READY plan plus one current review — the review floor is one, not three", () => {
    expect(loopFailures({ entries: entriesFor({ records: pairedLoop() }) })).toEqual([]);
  });

  it("stops counting a BROKEN review once its property WORDING is superseded", () => {
    // The behaviour the owner asked for. A retired wording must not block the landing.
    const records = [
      planRecord({ pass: "p2", tree: beforeTheWork }),
      anyPassRecord({ artifactId: "broken-1", pass: "r2", tree: onBranch, verdict: "BROKEN" }),
      anyPassRecord({ artifactId: "clean-1", pass: "r2", tree: onBranch, verdict: "CLEAN" }),
    ];
    const blocked = ledgerForBranch({ branch: "feature", now, records, repoRoot: REPO }).entries;
    expect(loopFailures({ entries: blocked }).length).toBe(1);

    const retired = ledgerForBranch({
      branch: "feature",
      now,
      records,
      repoRoot: REPO,
      supersessions: new Map([
        [
          "broken-1",
          {
            artifactId: "broken-1",
            atIso: "2026-09-12T12:00:00.000Z",
            propertyId: "r2-08",
            reason: "the wording demanded a uuid ANYWHERE, which no bounded search can satisfy",
            replacedBy: "clean-1",
          },
        ],
      ]),
    }).entries;
    expect(loopFailures({ entries: retired })).toEqual([]);
  });

  it("does not let a superseded pass SATISFY the review floor either", () => {
    // Both directions, deliberately. A retired wording counting as the branch's one review would turn the
    // verb into a way to land with no live review at all.
    const records = [
      planRecord({ pass: "p2", tree: beforeTheWork }),
      anyPassRecord({ artifactId: "only-1", pass: "r2", tree: onBranch, verdict: "CLEAN" }),
    ];
    const entries = ledgerForBranch({
      branch: "feature",
      now,
      records,
      repoRoot: REPO,
      supersessions: new Map([
        [
          "only-1",
          {
            artifactId: "only-1",
            atIso: "2026-09-12T12:00:00.000Z",
            propertyId: "r2-08",
            reason: "retired",
            replacedBy: "elsewhere",
          },
        ],
      ]),
    }).entries;
    expect(loopFailures({ entries })).toEqual([
      "1 review pass(es) ran but none is both current and conclusive — each either describes a tree that " +
        "has since changed, has provenance that could not be established, or produced no verdict a review can give",
    ]);
  });

  it("names both halves when the branch carries neither", () => {
    expect(loopFailures({ entries: entriesFor({ records: [] }) })).toEqual([NO_PLAN, NO_REVIEW]);
  });

  it("refuses a branch that was reviewed but never planned", () => {
    const records = [anyPassRecord({ pass: "r1", tree: onBranch })];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([NO_PLAN]);
  });

  it("refuses a branch that was planned but never reviewed", () => {
    const records = [planRecord({ pass: "p1", tree: beforeTheWork })];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([NO_REVIEW]);
  });

  /**
   * The post-hoc plan is the cheat the whole plan floor exists to catch: run `codex plan` AFTER writing the
   * code and a naive existence check goes green over a plan that planned nothing.
   */
  it("refuses a CURRENT plan, because a plan that read the landed tree cannot have preceded it", () => {
    const records = [planRecord({ pass: "p1", tree: onBranch }), anyPassRecord({ pass: "r1", tree: onBranch })];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([
      "1 planning pass(es) reached a verdict but none is both STALE and READY — " +
        "a CURRENT plan read the tree being landed, so it cannot show the work came after it, " +
        "and UNKNOWN provenance cannot show anything",
    ]);
  });

  it("does not count a plan whose provenance could not be established", () => {
    const { treeSha: _dropped, ...withoutSidecar } = beforeTheWork;
    const base = planRecord({ pass: "p1", tree: beforeTheWork });
    const records = [{ ...base, tree: withoutSidecar }, anyPassRecord({ pass: "r1", tree: onBranch })];

    expect(loopFailures({ entries: entriesFor({ records }) })[0]).toContain("none is both STALE and READY");
  });

  it("refuses when the latest conclusive plan is BLOCKED, even with an older STALE READY one", () => {
    const records = [
      planRecord({ createdAtIso: "2026-08-01T00:00:00.000Z", pass: "p1", tree: beforeTheWork }),
      planRecord({ createdAtIso: "2026-08-02T00:00:00.000Z", pass: "p2", tree: beforeTheWork, verdict: "BLOCKED" }),
      anyPassRecord({ pass: "r1", tree: onBranch }),
    ];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([
      "p2 is the latest planning pass and is BLOCKED — resolve its blockers, then run a later plan",
    ]);
  });

  /** Re-running `codex plan` is how a BLOCKED plan is resolved, so a later READY must clear it. */
  it("accepts a later READY plan that supersedes a BLOCKED one", () => {
    const records = [
      planRecord({ createdAtIso: "2026-08-01T00:00:00.000Z", pass: "p1", tree: beforeTheWork, verdict: "BLOCKED" }),
      planRecord({ createdAtIso: "2026-08-02T00:00:00.000Z", pass: "p2", tree: beforeTheWork }),
      anyPassRecord({ pass: "r1", tree: onBranch }),
    ];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([]);
  });

  it("does not count an UNKNOWN review as current", () => {
    const { treeSha: _dropped, ...withoutSidecar } = onBranch;
    const base = anyPassRecord({ pass: "r1", tree: onBranch });
    const records = [planRecord({ pass: "p1", tree: beforeTheWork }), { ...base, tree: withoutSidecar }];

    expect(loopFailures({ entries: entriesFor({ records }) })[0]).toContain("none is both current and conclusive");
  });

  it("refuses a review that is current and BROKEN", () => {
    const base = anyPassRecord({ pass: "r1", tree: onBranch });
    const broken: CodexArtifactRecord = {
      ...base,
      outcome: {
        answer: { counterexample: "x", evidence: "y", propertyId: "r1-01", summary: "s", verdict: "BROKEN" },
        kind: "answered",
        rawFinalResponse: "{}",
      },
      scope: { ...base.scope, pass: "r1" } as CodexArtifactRecord["scope"],
    };
    const records = [planRecord({ pass: "p1", tree: beforeTheWork }), broken];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([
      "r1 is CURRENT and BROKEN (r1-01) — fix it, then take the second and last review pass over the fixed diff",
    ]);
  });

  /**
   * Found by a Codex review of this gate. `createdAtIso` is millisecond resolution, so two passes launched
   * together share one, and the first conclusive row was then whatever the directory scan happened to yield:
   * the same ledger could report the loop complete or refuse it depending on nothing at all.
   */
  it("refuses when a BLOCKED plan shares the newest instant with a READY one, whichever order they arrive in", () => {
    const ready = planRecord({ createdAtIso: "2026-08-02T00:00:00.000Z", pass: "p1", tree: beforeTheWork });
    const blocked = planRecord({
      createdAtIso: "2026-08-02T00:00:00.000Z",
      pass: "p2",
      tree: beforeTheWork,
      verdict: "BLOCKED",
    });
    const review = anyPassRecord({ pass: "r1", tree: onBranch });
    const refusal = "p2 is the latest planning pass and is BLOCKED — resolve its blockers, then run a later plan";

    expect(loopFailures({ entries: entriesFor({ records: [ready, blocked, review] }) })).toEqual([refusal]);
    expect(loopFailures({ entries: entriesFor({ records: [blocked, ready, review] }) })).toEqual([refusal]);
  });

  /**
   * A record's `scope.mode` decides which arm it is, never its pass id. `scanPassRecords` shallow-decodes disk
   * JSON, so a record pairing `pass: "p1"` with `mode: "review"` parses fine — and the prefix test this
   * replaced counted it as the plan the floor requires. Found by a Codex review of this gate.
   */
  it("does not accept a review-mode record as the planning pass, whatever its pass id says", () => {
    const review = anyPassRecord({ pass: "r1", tree: beforeTheWork });
    const masquerading: CodexArtifactRecord = {
      ...review,
      artifactId: "id-masquerading",
      scope: { ...review.scope, pass: "p1" } as CodexArtifactRecord["scope"],
    };
    const records = [masquerading, anyPassRecord({ pass: "r2", tree: onBranch })];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([NO_PLAN]);
  });

  /** A pass recorded against another checkout is not evidence about this one, whatever it is named. */
  it("ignores a plan recorded in a different checkout on the same branch name", () => {
    const elsewhere = { ...planRecord({ pass: "p1", tree: beforeTheWork }), repoRoot: "/w/other" };
    const records = [elsewhere, anyPassRecord({ pass: "r1", tree: onBranch })];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([NO_PLAN]);
  });
});

/**
 * The counterexample a review pass built against the gate: a pass that RAN and concluded nothing was
 * satisfying the floor. `skills/codex/SKILL.md` says a no-verdict "is not a clean result", and the gate now
 * agrees — a pass that produced nothing cannot stand in for one that approved something. Asked of both arms.
 */
describe("loopFailures and a pass that reached no verdict", () => {
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
  const onBranch = treeOn({ branch: "feature", headSha: HEAD, patch: "" });
  const beforeTheWork = treeOn({ branch: "feature", headSha: OTHER_HEAD, patch: "" });
  const NO_VERDICT: CodexArtifactRecord["outcome"] = {
    kind: "no-verdict",
    rawFinalResponse: null,
    reason: "off-track",
    salvage: null,
  };
  const FATAL: CodexArtifactRecord["outcome"] = {
    cause: {
      quota: "credits-out",
      reported: "You hit your spend cap set by the owner of your workspace.",
      thrown: "Codex Exec exited with code 1",
    },
    error: { kind: "io", message: "the Codex transport failed", operation: "codex.run" },
    kind: "fatal",
    salvage: null,
  };

  function entriesFor({ records }: { records: readonly CodexArtifactRecord[] }): readonly LedgerEntry[] {
    return ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records }).entries;
  }

  it("does not accept a current NO_VERDICT review", () => {
    const base = anyPassRecord({ pass: "r1", tree: onBranch });
    const records = [planRecord({ pass: "p1", tree: beforeTheWork }), { ...base, outcome: NO_VERDICT }];

    expect(loopFailures({ entries: entriesFor({ records }) })[0]).toContain("none is both current and conclusive");
  });

  it("does not accept a current FATAL review", () => {
    const base = anyPassRecord({ pass: "r1", tree: onBranch });
    const records = [planRecord({ pass: "p1", tree: beforeTheWork }), { ...base, outcome: FATAL }];

    expect(loopFailures({ entries: entriesFor({ records }) })[0]).toContain("none is both current and conclusive");
  });

  it("does not accept a STALE NO_VERDICT plan, which established nothing to implement against", () => {
    const base = planRecord({ pass: "p1", tree: beforeTheWork });
    const records = [{ ...base, outcome: NO_VERDICT }, anyPassRecord({ pass: "r1", tree: onBranch })];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([
      "1 planning pass(es) ran but none reached a verdict — " +
        "each produced NO_VERDICT or failed outright, so nothing was established" +
        " — the newest, p1, concluded nothing: tripwire stopped the pass as off-track; nothing was observed before the stop",
    ]);
  });

  it("names the newest plan's transport cause, so a spend cap is named on the first read", () => {
    const base = planRecord({ pass: "p1", tree: beforeTheWork });
    const records = [{ ...base, outcome: FATAL }, anyPassRecord({ pass: "r1", tree: onBranch })];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([
      "1 planning pass(es) ran but none reached a verdict — " +
        "each produced NO_VERDICT or failed outright, so nothing was established" +
        " — the newest, p1, failed outright: transport failed: " +
        "You hit your spend cap set by the owner of your workspace. [quota: credits-out]",
    ]);
  });

  it("names the NEWEST plan, not an older fault behind a newer no-verdict", () => {
    const older = { ...planRecord({ pass: "p1", tree: beforeTheWork }), outcome: FATAL };
    const newer = {
      ...planRecord({ createdAtIso: "2026-08-02T02:00:00.000Z", pass: "p2", tree: beforeTheWork }),
      outcome: NO_VERDICT,
    };
    const records = [older, newer, anyPassRecord({ pass: "r1", tree: onBranch })];

    const [planLine] = loopFailures({ entries: entriesFor({ records }) });
    expect(planLine).toContain(" — the newest, p2, concluded nothing: tripwire stopped the pass as off-track");
    expect(planLine).not.toContain("spend cap");
  });

  it("names the newest review's transport cause on the review floor", () => {
    const base = anyPassRecord({ pass: "r1", tree: onBranch });
    const records = [planRecord({ pass: "p1", tree: beforeTheWork }), { ...base, outcome: FATAL }];

    expect(loopFailures({ entries: entriesFor({ records }) })[0]).toContain(
      " — the newest, r1, failed outright: transport failed: You hit your spend cap",
    );
  });

  it("adds no cause to a floor that is met, however many older passes failed", () => {
    const failedPlan = {
      ...planRecord({ createdAtIso: "2026-08-02T00:30:00.000Z", pass: "p2", tree: beforeTheWork }),
      outcome: FATAL,
    };
    const records = [
      failedPlan,
      planRecord({ pass: "p1", tree: beforeTheWork }),
      anyPassRecord({ pass: "r1", tree: onBranch }),
    ];

    expect(loopFailures({ entries: entriesFor({ records }) })).toEqual([]);
  });
});

/**
 * The regression this block exists for, measured on a live workspace spend cap: `codex status
 * --check` printed `no planning pass has run on this branch` — the same sentence an unrun
 * branch prints — while `slopweaver codex quota show`, seconds later on the same machine, printed
 * `usage-limit` evidence observed at 09:27:23.357Z. Nothing on a branch with NO ROWS can witness a cap, so
 * the witness has to be supplied. Rule 9's cap path (an owner ruling) only works if a session can TELL.
 */
describe("loopFailures and a LIVE cap the ledger cannot witness", () => {
  const now = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });
  const onBranch = treeOn({ branch: "feature", headSha: HEAD, patch: "" });
  const beforeTheWork = treeOn({ branch: "feature", headSha: OTHER_HEAD, patch: "" });

  const CAP: CodexQuotaEvidence = { kind: "usage-limit", observedAtIso: "2026-09-14T09:27:23.357Z" };
  const WITNESS =
    "Codex is CAPPED (the quota gate reports usage-limit, observed 2026-09-14T09:27:23.357Z — " +
    "`slopweaver codex quota show`)";

  function entriesFor({ records }: { records: readonly CodexArtifactRecord[] }): readonly LedgerEntry[] {
    return ledgerForBranch({ repoRoot: REPO, branch: "feature", now, records }).entries;
  }

  it("names the cap on the plan half of a branch with no rows at all", () => {
    const [planLine] = loopFailures({ cap: CAP, entries: entriesFor({ records: [] }) });

    expect(planLine).toBe(
      "no planning pass has run on this branch — nothing planned the work before it was " +
        `written. ${WITNESS}, and nothing waits on it (the owner's ruling): BEFORE the work, a ` +
        "visible Claude session takes the plan — `slopweaver codex plan-fallback prepare`, answer the packet, then " +
        "`codex plan-fallback record` before any edit; work that already began without one rides " +
        '`--acknowledge codex-loop-incomplete --reason "…"` on the landing verb, the reason citing ' +
        "$SLOPWEAVER_HOME/supervisor-scratch/handoff-9257/owner-turn-253-2.txt and written to the door ledger",
    );
  });

  it("routes the review half of a branch with no rows to the Claude fallback", () => {
    const failures = loopFailures({ cap: CAP, entries: entriesFor({ records: [] }) });

    expect(failures[1]).toBe(
      "no review pass has run on this branch — the diff has never been read by the second brain. " +
        `${WITNESS}, so a visible Claude session takes this review (rule 9): ` +
        "`slopweaver codex review-fallback prepare`, answer the packet, then `codex review-fallback record`",
    );
  });

  it("says nothing about a cap when the gate is not refusing — the same branch, no witness", () => {
    const failures = loopFailures({ entries: entriesFor({ records: [] }) });

    expect(failures).toEqual([
      "no planning pass has run on this branch — nothing planned the work before it was written",
      "no review pass has run on this branch — the diff has never been read by the second brain",
    ]);
  });

  /** A cap is not a plan and not a review: it may only ever explain a refusal, never lift one. */
  it("still refuses every half it refused before, with the cap supplied", () => {
    const records = [planRecord({ pass: "p1", tree: onBranch })];

    expect(loopFailures({ cap: CAP, entries: entriesFor({ records }) }).length).toBe(2);
  });

  /** And the other direction: a met floor stays met, so a cap can never turn a green branch red. */
  it("adds nothing to a floor that is already met", () => {
    const records = [planRecord({ pass: "p2", tree: beforeTheWork }), anyPassRecord({ pass: "r1", tree: onBranch })];

    expect(loopFailures({ cap: CAP, entries: entriesFor({ records }) })).toEqual([]);
  });
});
