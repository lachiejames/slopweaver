import { describe, expect, it } from "vitest";

import { marginalPassReading, planPassReading } from "../../../codex/marginalYield.js";
import type { CodexArtifactRecord, CodexAttempt, PlanPassId, ReviewPassId } from "../../../codex/types.js";

const REPO = "/w/repo";
const OTHER_REPO = "/w/other";
const DIFF = "d".repeat(64);
const OTHER_DIFF = "e".repeat(64);
const NO_GAP = { withoutSidecar: 0, unreadable: 0 };

/** An attempt whose only load-bearing field here is when it STARTED — that is what the ordinal sorts on. */
function startedAt({ iso }: { iso: string }): CodexAttempt {
  return {
    elapsedMs: 10,
    finishedAtIso: iso,
    items: { counts: {}, kind: "measured" },
    kind: "initial",
    startedAtIso: iso,
    status: "answered",
    threadId: "t",
    usage: {
      kind: "measured",
      usage: {
        cache_write_input_tokens: 0,
        cached_input_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
      },
    },
  };
}

/** One review record on one diff. */
function review({
  artifactId,
  pass,
  propertyId,
  startedAtIso,
  verdict = "CLEAN",
  diffSha256 = DIFF,
  repoRoot = REPO,
  counterexample = "",
  // A case that does not care when the record was WRITTEN gets the start instant, which is the ordinary shape;
  // the two cases that do care pass it, and those are the ones proving the sort keys on start, not creation.
  createdAtIso = startedAtIso,
}: {
  artifactId: string;
  pass: ReviewPassId;
  propertyId: string;
  startedAtIso: string;
  verdict?: "CLEAN" | "BROKEN";
  diffSha256?: string;
  repoRoot?: string;
  counterexample?: string;
  createdAtIso?: string;
}): CodexArtifactRecord {
  return {
    artifactId,
    attempts: [startedAt({ iso: startedAtIso })],
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso,
    observedElapsedMs: 20,
    outcome: {
      answer: { counterexample, evidence: "", propertyId, summary: "held", verdict },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    repoRoot,
    requestedApprovalPolicy: "never",
    requestedModel: "gpt-6-astra",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "medium",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: {
      baseRef: "origin/main",
      baseSha: "b".repeat(40),
      diffBytes: 10,
      diffSha256,
      headSha: "h".repeat(40),
      mode: "review",
      pass,
      property: { id: propertyId, statement: "a falsifiable claim" },
    },
  };
}

/** A review record that went FATAL — no answer at all, but it still cost wall clock and still happened. */
function fatal({
  artifactId,
  pass,
  startedAtIso,
  diffSha256 = DIFF,
}: {
  artifactId: string;
  pass: ReviewPassId;
  startedAtIso: string;
  diffSha256?: string;
}): CodexArtifactRecord {
  return {
    ...review({ artifactId, diffSha256, pass, propertyId: `${pass}-01`, startedAtIso }),
    outcome: {
      cause: {
        quota: null,
        reported: "You hit your spend cap set by the owner of your workspace",
        thrown: "Codex Exec exited with code 1",
      },
      error: { kind: "CODEX_FAILED", message: "the Codex transport failed", operation: "codex.review" },
      kind: "fatal",
      salvage: null,
    },
  };
}

/** A planning record, which has no diff. */
function plan({
  pass,
  branch,
  headSha,
}: {
  pass: PlanPassId;
  branch: string | null;
  headSha: string | undefined;
}): CodexArtifactRecord {
  const base = {
    artifactId: `plan-${pass}`,
    attempts: [startedAt({ iso: "2026-06-01T00:00:00.000Z" })],
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso: "2026-06-01T00:00:00.000Z",
    observedElapsedMs: 20,
    outcome: {
      answer: { blockers: [], bodyMarkdown: "", summary: "planned", verdict: "READY" },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    repoRoot: REPO,
    requestedApprovalPolicy: "never",
    requestedModel: "gpt-6-astra",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "medium",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: { mode: "plan", pass, promptBytes: 1, promptSha256: "abc" },
  } as const;
  if (headSha === undefined) {
    return base;
  }
  return { ...base, tree: { branch, dirtyBytes: 0, fingerprint: "f".repeat(64), headSha, treeSha: "t".repeat(40) } };
}

describe("marginalPassReading", () => {
  it("numbers three properties on one diff 1, 2, 3 — the invocation, not the arm", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({ artifactId: "c", pass: "r3", propertyId: "r3-01", startedAtIso: "2026-06-01T00:00:30.000Z" }),
        review({ artifactId: "a", pass: "r1", propertyId: "r1-01", startedAtIso: "2026-06-01T00:00:10.000Z" }),
        review({ artifactId: "b", pass: "r2", propertyId: "r2-01", startedAtIso: "2026-06-01T00:00:20.000Z" }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.prior.map((row) => [row.ordinal, row.pass, row.artifactId])).toStrictEqual([
      [1, "r1", "a"],
      [2, "r2", "b"],
      [3, "r3", "c"],
    ]);
    expect(reading.nextOrdinal).toBe(4);
  });

  it("counts a repeated property as its own invocation rather than collapsing the two", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({ artifactId: "a", pass: "r1", propertyId: "r1-01", startedAtIso: "2026-06-01T00:00:10.000Z" }),
        review({ artifactId: "b", pass: "r1", propertyId: "r1-01", startedAtIso: "2026-06-01T00:00:20.000Z" }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.prior.length).toBe(2);
    expect(reading.nextOrdinal).toBe(3);
  });

  it("starts a CHANGED diff at ordinal 1 — its own sequence, not the other one's continuation", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({ artifactId: "a", pass: "r1", propertyId: "r1-01", startedAtIso: "2026-06-01T00:00:10.000Z" }),
        review({ artifactId: "b", pass: "r2", propertyId: "r2-01", startedAtIso: "2026-06-01T00:00:20.000Z" }),
      ],
      target: { diffSha256: OTHER_DIFF, repoRoot: REPO },
    });

    expect(reading.prior).toStrictEqual([]);
    expect(reading.nextOrdinal).toBe(1);
  });

  it("gives a FATAL invocation its ordinal and counts it apart from the conclusive denominator", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({ artifactId: "a", pass: "r1", propertyId: "r1-01", startedAtIso: "2026-06-01T00:00:10.000Z" }),
        fatal({ artifactId: "b", pass: "r2", startedAtIso: "2026-06-01T00:00:20.000Z" }),
        review({
          artifactId: "c",
          pass: "r3",
          propertyId: "r3-01",
          startedAtIso: "2026-06-01T00:00:30.000Z",
          verdict: "BROKEN",
        }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.prior.map((row) => row.ordinal)).toStrictEqual([1, 2, 3]);
    expect(reading.priorConclusive).toBe(2);
    expect(reading.priorTally).toStrictEqual({ broken: 1, clean: 1, fatal: 1, noVerdict: 0 });
  });

  it("names two invocations that started at the same instant as TIED rather than ordering them", () => {
    const tied = "2026-06-01T00:00:10.000Z";
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({ artifactId: "a", pass: "r1", propertyId: "r1-01", startedAtIso: tied }),
        review({ artifactId: "b", pass: "r1", propertyId: "r1-02", startedAtIso: tied }),
        review({ artifactId: "c", pass: "r2", propertyId: "r2-01", startedAtIso: "2026-06-01T00:00:20.000Z" }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.prior.map((row) => [row.artifactId, row.tiedStart])).toStrictEqual([
      ["a", true],
      ["b", true],
      ["c", false],
    ]);
  });

  it("excludes the target's own sequence from the historical comparator at its next ordinal", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({ artifactId: "t1", pass: "r1", propertyId: "r1-01", startedAtIso: "2026-06-01T00:00:10.000Z" }),
        review({
          artifactId: "t2",
          pass: "r2",
          propertyId: "r2-01",
          startedAtIso: "2026-06-01T00:00:20.000Z",
          verdict: "BROKEN",
        }),
        review({
          artifactId: "o1",
          diffSha256: OTHER_DIFF,
          pass: "r1",
          propertyId: "r1-01",
          startedAtIso: "2026-05-01T00:00:10.000Z",
        }),
        review({
          artifactId: "o2",
          diffSha256: OTHER_DIFF,
          pass: "r2",
          propertyId: "r2-01",
          startedAtIso: "2026-05-01T00:00:20.000Z",
        }),
        review({
          artifactId: "o3",
          diffSha256: OTHER_DIFF,
          pass: "r3",
          propertyId: "r3-01",
          startedAtIso: "2026-05-01T00:00:30.000Z",
          verdict: "BROKEN",
        }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    // The target reached ordinal 2, so the next is 3. Only the OTHER diff has an invocation at 3, and it is
    // BROKEN. The target's own BROKEN at its ordinal 2 must not appear anywhere in this figure.
    expect(reading.yieldAtNextOrdinal).toStrictEqual({
      earliestIso: "2026-05-01T00:00:30.000Z",
      latestIso: "2026-05-01T00:00:30.000Z",
      ordinal: 3,
      sampleDiffs: 1,
      tally: { broken: 1, clean: 0, fatal: 0, noVerdict: 0 },
    });
  });

  it("reports no comparator at all when no other diff reached the next ordinal", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [review({ artifactId: "a", pass: "r1", propertyId: "r1-01", startedAtIso: "2026-06-01T00:00:10.000Z" })],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.yieldAtNextOrdinal.sampleDiffs).toBe(0);
    expect(reading.yieldAtNextOrdinal.earliestIso).toBeUndefined();
  });

  it("never counts another CHECKOUT's records, even on the same diff digest", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({ artifactId: "a", pass: "r1", propertyId: "r1-01", startedAtIso: "2026-06-01T00:00:10.000Z" }),
        review({
          artifactId: "elsewhere",
          pass: "r2",
          propertyId: "r2-01",
          repoRoot: OTHER_REPO,
          startedAtIso: "2026-06-01T00:00:20.000Z",
        }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.prior.map((row) => row.artifactId)).toStrictEqual(["a"]);
  });

  it("stratifies by arm so a claim about later passes cannot be made from mixed properties", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({
          artifactId: "a",
          pass: "r1",
          propertyId: "r1-01",
          startedAtIso: "2026-06-01T00:00:10.000Z",
          verdict: "BROKEN",
        }),
        review({ artifactId: "b", pass: "r1", propertyId: "r1-02", startedAtIso: "2026-06-01T00:00:20.000Z" }),
        review({
          artifactId: "c",
          pass: "r3",
          propertyId: "r3-01",
          startedAtIso: "2026-06-01T00:00:30.000Z",
          verdict: "BROKEN",
        }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.strata).toStrictEqual([
      { pass: "r1", tally: { broken: 1, clean: 1, fatal: 0, noVerdict: 0 } },
      { pass: "r3", tally: { broken: 1, clean: 0, fatal: 0, noVerdict: 0 } },
    ]);
  });

  it("carries the scan's incomplete history through, so the ordinal can say it is a RECORDED one", () => {
    const reading = marginalPassReading({
      historyGap: { withoutSidecar: 277, unreadable: 2 },
      records: [],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.historyGap).toStrictEqual({ withoutSidecar: 277, unreadable: 2 });
  });

  it("carries the recorded counterexample when there is one, and the summary when there is not", () => {
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({
          artifactId: "a",
          counterexample: "call f with -1",
          pass: "r1",
          propertyId: "r1-01",
          startedAtIso: "2026-06-01T00:00:10.000Z",
          verdict: "BROKEN",
        }),
        review({ artifactId: "b", pass: "r2", propertyId: "r2-01", startedAtIso: "2026-06-01T00:00:20.000Z" }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.prior.map((row) => row.recorded)).toStrictEqual(["call f with -1", "held"]);
  });

  it("orders by attempt START, not by when the record was written", () => {
    // The long pass started first and finished last. Ordering by creation reverses them, which is what
    // happens on every fanned-out run where one property is slower than the others.
    const reading = marginalPassReading({
      historyGap: NO_GAP,
      records: [
        review({
          artifactId: "slow",
          createdAtIso: "2026-06-01T01:00:00.000Z",
          pass: "r1",
          propertyId: "r1-01",
          startedAtIso: "2026-06-01T00:00:10.000Z",
        }),
        review({
          artifactId: "quick",
          createdAtIso: "2026-06-01T00:00:25.000Z",
          pass: "r2",
          propertyId: "r2-01",
          startedAtIso: "2026-06-01T00:00:20.000Z",
        }),
      ],
      target: { diffSha256: DIFF, repoRoot: REPO },
    });

    expect(reading.prior.map((row) => row.artifactId)).toStrictEqual(["slow", "quick"]);
  });
});

describe("planPassReading", () => {
  it("states the diff ordinal as not applicable and gives the branch and HEAD instead", () => {
    expect(
      planPassReading({ record: plan({ branch: "some-branch", headSha: "a".repeat(40), pass: "p2" }) }),
    ).toStrictEqual({
      branch: "some-branch",
      diffOrdinal: "not-applicable",
      headSha: "a".repeat(40),
      pass: "p2",
    });
  });

  it("answers null for a plan that captured no tree, rather than an empty string that reads as a head", () => {
    expect(planPassReading({ record: plan({ branch: null, headSha: undefined, pass: "p1" }) })).toStrictEqual({
      branch: null,
      diffOrdinal: "not-applicable",
      headSha: null,
      pass: "p1",
    });
  });
});
