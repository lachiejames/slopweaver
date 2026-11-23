/**
 * The briefing quiz block's schema and its above-fold word charge: a complete lesson row and a complete
 * trace row parse back unchanged; a claim is capped at the register's own 400 characters; an instant no
 * clock can parse, a malformed claim or quiz id, a domain that is not a slug, a verdict outside the two, a
 * tier outside the four, an unknown outcome, an empty optional string and an unknown key are each refused;
 * and only the domain, the claim and the quiz id are charged above the fold.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { quizAboveFoldWords, quizSchema } from "../../../../outbound/briefing/quizSchema.js";

const LESSON = {
  claim: "The staging pool exhausts when the reaper is paused",
  domain: "staging-db",
  fleetCaveat: "measured once",
  fleetEvidence: "pool at 100/100 for 40 minutes on 3 Oct",
  fleetRecordedAtIso: "2026-09-12T02:06:09Z",
  fleetRepro: "slopweaver datadog query pool.used",
  fleetVerdict: "confirmed",
  lessonId: "l-0123456789abcdef",
  quizId: "q-fedcba9876543210",
  tier: 2,
};

const TRACE = {
  claim: "Searching the corpus for the PR URL finds the thread",
  domain: "slack",
  fleetEvidence: "three of three threads found",
  fleetRecordedAtIso: "2026-10-01T00:00:00.000+10:00",
  fleetVerdict: "refuted",
  lessonId: "t-00000000000000ff",
  quizId: "q-00000000000000aa",
  traceOutcome: "paid",
  traceProbe: "slopweaver slack search <url>",
  traceQuestion: "where was the PR discussed",
};

/** The messages of a refused parse, thrown on an accepted one so a test cannot read a success as a failure. */
function messagesOf({ result }: { result: z.ZodSafeParseResult<unknown> }): readonly string[] {
  if (result.success) {
    throw new Error("expected the parse to be refused");
  }
  return result.error.issues.map((issue) => issue.message);
}

describe("quizSchema", () => {
  it("parses a complete lesson row back to exactly the input", () => {
    expect(quizSchema.parse(LESSON)).toEqual({
      claim: "The staging pool exhausts when the reaper is paused",
      domain: "staging-db",
      fleetCaveat: "measured once",
      fleetEvidence: "pool at 100/100 for 40 minutes on 3 Oct",
      fleetRecordedAtIso: "2026-09-12T02:06:09Z",
      fleetRepro: "slopweaver datadog query pool.used",
      fleetVerdict: "confirmed",
      lessonId: "l-0123456789abcdef",
      quizId: "q-fedcba9876543210",
      tier: 2,
    });
  });

  it("parses a complete trace row, with no tier, back to exactly the input", () => {
    expect(quizSchema.parse(TRACE)).toEqual({
      claim: "Searching the corpus for the PR URL finds the thread",
      domain: "slack",
      fleetEvidence: "three of three threads found",
      fleetRecordedAtIso: "2026-10-01T00:00:00.000+10:00",
      fleetVerdict: "refuted",
      lessonId: "t-00000000000000ff",
      quizId: "q-00000000000000aa",
      traceOutcome: "paid",
      traceProbe: "slopweaver slack search <url>",
      traceQuestion: "where was the PR discussed",
    });
  });

  it("accepts a 400-character claim and refuses a 401-character one", () => {
    expect(quizSchema.safeParse({ ...LESSON, claim: "x".repeat(400) }).success).toBe(true);
    expect(quizSchema.safeParse({ ...LESSON, claim: "x".repeat(401) }).success).toBe(false);
  });

  it("refuses an instant no clock can parse, saying what an instant must be", () => {
    expect(messagesOf({ result: quizSchema.safeParse({ ...LESSON, fleetRecordedAtIso: "not a date" }) })).toEqual([
      "the quiz's instant must be an ISO-8601 timestamp a clock can parse, as in `2026-09-12T02:06:09Z`.",
    ]);
  });

  it("refuses a claim id that is neither l- nor t- and sixteen hex characters, naming the register's shape", () => {
    const [message] = messagesOf({ result: quizSchema.safeParse({ ...LESSON, lessonId: "x-0123456789abcdef" }) });

    expect(message).toContain("`l-` for a lesson or `t-` for a trace, then sixteen hex characters");
    expect(quizSchema.safeParse({ ...LESSON, lessonId: "l-0123456789ABCDEF" }).success).toBe(false);
  });

  it("refuses a quiz id that is not q- and sixteen hex characters, naming the ledger's shape", () => {
    const [message] = messagesOf({ result: quizSchema.safeParse({ ...LESSON, quizId: "q-0123" }) });

    expect(message).toContain("the quiz's own id is the ledger's: `q-` and sixteen hex characters");
  });

  it("refuses a domain that is not a lowercase slug", () => {
    expect(
      ["Staging", "staging_db", "-staging", "s"].map((domain) => quizSchema.safeParse({ ...LESSON, domain }).success),
    ).toEqual([false, false, false, false]);
  });

  it("refuses a verdict outside confirmed and refuted, and an unknown trace outcome", () => {
    expect(quizSchema.safeParse({ ...LESSON, fleetVerdict: "unsettled" }).success).toBe(false);
    expect(quizSchema.safeParse({ ...TRACE, traceOutcome: "partial" }).success).toBe(false);
  });

  it("accepts tiers one and four and refuses zero and five", () => {
    expect([0, 1, 4, 5].map((tier) => quizSchema.safeParse({ ...LESSON, tier }).success)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("refuses an empty optional string rather than reading it as absent", () => {
    expect(
      ["fleetCaveat", "fleetRepro", "traceProbe", "traceQuestion"].map(
        (key) => quizSchema.safeParse({ ...LESSON, [key]: "" }).success,
      ),
    ).toEqual([false, false, false, false]);
  });

  it("refuses an unknown key", () => {
    expect(quizSchema.safeParse({ ...LESSON, fleetSummary: "x" }).success).toBe(false);
  });
});

describe("quizAboveFoldWords", () => {
  it("charges the domain, the claim and the quiz id, and nothing inside the fold", () => {
    expect(
      quizAboveFoldWords({
        quiz: {
          claim: "pool exhausts when paused",
          domain: "staging-db",
          fleetCaveat: "a caveat of five words",
          fleetEvidence: "evidence that is folded away entirely",
          fleetRecordedAtIso: "2026-09-12T02:06:09Z",
          fleetRepro: "a long repro command here",
          fleetVerdict: "confirmed",
          lessonId: "l-0123456789abcdef",
          quizId: "q-fedcba9876543210",
        },
      }),
    ).toBe(6);
  });
});
