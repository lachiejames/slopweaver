/**
 * `reviewRounds` — counting a re-review, carrying what the last round left open, and the narrowing a late
 * round's packet carries. Pure: a literal in, a number or a block of lines out.
 */
import { describe, expect, it } from "vitest";

import type { ReviewVerdict } from "../../../../admit/reviewVerdict.js";
import {
  carriedForwardOf,
  REVIEW_ROUND_CAP,
  reviewRoundLines,
  roundCapBreakage,
  roundNarrowingLines,
  unresolvedHighImpactClaims,
} from "../../../../live/turn/reviewRounds.js";

// register-class: bot-answer-review-rounds-uncapped (docs/recurring-failure-register/bindings.md)

const VERDICT: ReviewVerdict = {
  answerDigest: "sha256:" + "a".repeat(64),
  authorSession: "author workspace workspace:1 (id-workspace:1)",
  claims: [
    { evidence: "the thread", impact: "high", support: "supported", text: "the pool exhausted at 14:02" },
    { impact: "high", support: "unsupported", text: "the answer delivers every artifact the question asked for" },
    { impact: "high", support: "unverifiable", text: "the rollback ran cleanly" },
    { impact: "low", support: "unsupported", text: "the before/after table is mislabelled" },
  ],
  outcome: "broken",
  reviewerSession: "reviewer workspace workspace:9 (id-workspace:9)",
  schemaVersion: 1,
};

describe("unresolvedHighImpactClaims", () => {
  it("takes every high-impact claim that is not supported, and nothing else", () => {
    expect(unresolvedHighImpactClaims({ verdict: VERDICT })).toStrictEqual([
      "the answer delivers every artifact the question asked for",
      "the rollback ran cleanly",
    ]);
  });

  it("is empty for a verdict whose high-impact claims all landed", () => {
    const clean: ReviewVerdict = {
      ...VERDICT,
      claims: [{ evidence: "the thread", impact: "high", support: "supported", text: "one claim" }],
      outcome: "clean",
    };

    expect(unresolvedHighImpactClaims({ verdict: clean })).toStrictEqual([]);
  });
});

describe("carriedForwardOf", () => {
  it("starts an ask at round 1 with nothing carried", () => {
    expect(carriedForwardOf({ outgoing: undefined, previousVerdict: undefined })).toStrictEqual({
      carriedReads: [],
      carriedSettled: [],
      carriedUnresolved: [],
      previousOutcome: undefined,
      previousSettledLiveCount: 0,
      reviewStartedAt: undefined,
      round: 1,
      settledDigest: undefined,
    });
  });

  it("increments the round and carries the outgoing round's own unresolved claims", () => {
    expect(
      carriedForwardOf({ outgoing: { carriedUnresolved: ["something older"], round: 2 }, previousVerdict: VERDICT }),
    ).toStrictEqual({
      // "the pool exhausted at 14:02" is supported and high with no restsOn (live) and no read — settled live,
      // carried neither way, which is exactly what `carryStarvationBreakage` counts.
      carriedReads: [],
      carriedSettled: [],
      carriedUnresolved: ["the answer delivers every artifact the question asked for", "the rollback ran cleanly"],
      previousOutcome: "broken",
      previousSettledLiveCount: 1,
      reviewStartedAt: undefined,
      round: 3,
      settledDigest: VERDICT.answerDigest,
    });
  });

  it("carries the previous list UNCHANGED when the outgoing reviewer wrote no verdict — nothing was resolved", () => {
    expect(
      carriedForwardOf({
        outgoing: { carriedUnresolved: ["the link is missing"], round: 4 },
        previousVerdict: undefined,
      }),
    ).toStrictEqual({
      carriedReads: [],
      carriedSettled: [],
      carriedUnresolved: ["the link is missing"],
      previousOutcome: undefined,
      previousSettledLiveCount: 0,
      reviewStartedAt: undefined,
      round: 5,
      settledDigest: undefined,
    });
  });

  it("takes round 1's own spawn as the review start when the outgoing record IS round 1", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: [], round: 1, spawnedAt: "2026-09-15T04:00:00.000Z" },
      previousVerdict: { ...VERDICT, outcome: "clean" },
    });

    expect(inherited.reviewStartedAt).toBe("2026-09-15T04:00:00.000Z");
    expect(inherited.previousOutcome).toBe("clean");
  });

  it("carries a later record's review start forward rather than its own spawn", () => {
    const inherited = carriedForwardOf({
      outgoing: {
        carriedUnresolved: [],
        reviewStartedAt: "2026-09-15T04:00:00.000Z",
        round: 3,
        spawnedAt: "2026-09-15T05:00:00.000Z",
      },
      previousVerdict: undefined,
    });

    expect(inherited.reviewStartedAt).toBe("2026-09-15T04:00:00.000Z");
  });

  it("says the start is unknown for a round-2 record written before the clock existed", () => {
    const inherited = carriedForwardOf({
      outgoing: { carriedUnresolved: [], round: 2, spawnedAt: "2026-09-15T05:00:00.000Z" },
      previousVerdict: undefined,
    });

    expect(inherited.reviewStartedAt).toBe(undefined);
  });
});

describe("reviewRoundLines", () => {
  it("says round 1 is the first review and lists nothing", () => {
    const lines = reviewRoundLines({ carriedUnresolved: ["ignored"], round: 1 }).join("\n");

    expect(lines).toContain("Round 1 — the first review of this ask. Nothing has been sent back yet.");
    expect(lines).not.toContain("ignored");
  });

  it("names the round, how many times the answer came back, and every carried claim", () => {
    const lines = reviewRoundLines({ carriedUnresolved: ["the deploy link is absent", "the rollback"], round: 3 }).join(
      "\n",
    );

    expect(lines).toContain("Round 3 of review for this ask. The answer has been sent back 2 time(s)");
    expect(lines).toContain("- the deploy link is absent");
    expect(lines).toContain("- the rollback");
  });

  it("says so when the previous round ended on nothing high-impact", () => {
    expect(reviewRoundLines({ carriedUnresolved: [], round: 2 }).join("\n")).toContain(
      "the previous round left no high-impact claim unresolved",
    );
  });
});

describe("roundNarrowingLines", () => {
  it("adds nothing at all inside the cap — an ordinary review reads as it always did", () => {
    expect(roundNarrowingLines({ round: REVIEW_ROUND_CAP })).toStrictEqual([]);
    expect(roundNarrowingLines({ round: 1 })).toStrictEqual([]);
  });

  it("past the cap, keeps every standing and carried claim binding and demotes only UNREQUESTED scope", () => {
    const lines = roundNarrowingLines({ round: REVIEW_ROUND_CAP + 1 }).join("\n");

    expect(lines).toContain("This ask is on round 4");
    expect(lines).toContain(
      "the two standing claims still bind in full — the deliverable claim, the supersession claim",
    );
    expect(lines).toContain("does section 9's voice claim, exactly as on every round");
    expect(lines).toContain("every claim listed under `This round` still binds in full");
    expect(lines).toContain("a NEW claim about something the question DID ask for is `high` impact");
    expect(lines).toContain("the question did NOT ask for is `low`");
    expect(lines).toContain("Nothing here lowers the bar on what is delivered.");
  });
});

describe("roundCapBreakage", () => {
  it("names the ask, the round and the cap, and records that the round still opened", () => {
    const breakage = roundCapBreakage({
      askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
      atIso: "2026-08-27T05:00:00.000Z",
      round: 6,
    });

    expect(breakage.thread).toBe("C1/1785000000.000100");
    expect(breakage.what).toBe("turn review opened round 6 for this ask");
    expect(breakage.error).toBe("review round 6 exceeds the cap of 3");
    expect(breakage.atIso).toBe("2026-08-27T05:00:00.000Z");
    expect(breakage.didInstead).toContain("opened the round anyway with its packet narrowed");
  });
});

describe("roundNarrowingLines — present-image fitness is never unrequested scope", () => {
  it("keeps section 1c binding past the round cap", () => {
    const lines = roundNarrowingLines({ round: REVIEW_ROUND_CAP + 1 }).join("\n");

    expect(lines).toContain("section 1c still binds in full");
    expect(lines).toContain("`high`-impact finding on ANY round");
  });

  it("says an image observation is never carried as a settled answer-only claim", () => {
    const lines = roundNarrowingLines({ round: REVIEW_ROUND_CAP + 1 }).join("\n");

    expect(lines).toContain("an unchanged answer is not");
    expect(lines).toContain("`images` are path strings");
  });

  it("still says nothing at all inside the cap", () => {
    expect(roundNarrowingLines({ round: REVIEW_ROUND_CAP })).toEqual([]);
  });
});
