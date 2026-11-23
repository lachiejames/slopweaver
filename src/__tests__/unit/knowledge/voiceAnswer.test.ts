/**
 * What the owner said about a proposed belief: the builder, and the readers that decide what is still open.
 *
 * The falsifiable claim under most of this file is that a mark is a REACTION and not a verdict — nothing
 * here maps `right` onto `confirmed`, and the tests are written so a future change that did would fail.
 */
import { describe, expect, it } from "vitest";

import { ANSWER_WHY_MAX, buildAnswer } from "../../../knowledge/voice/answer.js";
import { type BeliefProposal, PROPOSAL_CLAIM_MAX } from "../../../knowledge/voice/types.js";
import { answerFor, openProposals, parseProposalLine } from "../../../knowledge/voice/unit.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const AT = "2026-09-12T01:00:00.000Z";
const LATER = "2026-09-12T02:00:00.000Z";

/** One proposed belief, varying only what a test overrides. */
const proposed = (over: Partial<Extract<BeliefProposal, { kind: "proposed" }>> = {}): BeliefProposal => ({
  claim: "The gold tier is being built up as the corpus grows.",
  domain: "slopweaver-corpus",
  held: "stated-uncertain",
  kind: "proposed",
  proposalId: "p-0123456789abcdef",
  quote: "do we ever build up that gold",
  reviewedAtIso: AT,
  run: "half-kept-ledger-a",
  unitId: "u-0123456789abcdef",
  ...over,
});

/** The arguments a valid answer is built from. */
const valid = {
  mark: "right",
  proposalId: "p-0123456789abcdef",
  reviewedAtIso: LATER,
  run: "half-kept-ledger-a",
  why: "yep, that's what I thought",
} as const;

describe("buildAnswer", () => {
  it("records the owner's mark and their own words against the proposal", () => {
    const row = unwrap(buildAnswer({ ...valid, proposals: [proposed()] }));

    expect(row.kind).toBe("answered");
    expect(row.mark).toBe("right");
    expect(row.why).toBe("yep, that's what I thought");
    expect(row.proposalId).toBe("p-0123456789abcdef");
  });

  it("carries the unit forward, so one reader can group the owner's answers either way", () => {
    expect(unwrap(buildAnswer({ ...valid, proposals: [proposed()] })).unitId).toBe("u-0123456789abcdef");
  });

  it("records no verdict, because a mark says the fleet read the owner right and not that the claim is true", () => {
    const row = unwrap(buildAnswer({ ...valid, proposals: [proposed()] }));

    expect(Object.keys(row).toSorted()).toEqual([
      "kind",
      "mark",
      "proposalId",
      "reviewedAtIso",
      "run",
      "unitId",
      "why",
    ]);
  });

  it("keeps the owner's own wording when they supplied one", () => {
    const row = unwrap(
      buildAnswer({
        ...valid,
        correction: "The gold tier has never been built at all.",
        mark: "partly",
        proposals: [proposed()],
      }),
    );

    expect(row.correction).toBe("The gold tier has never been built at all.");
  });

  it("leaves the correction absent on a bare `wrong`, rather than inventing the right claim", () => {
    const row = unwrap(buildAnswer({ ...valid, mark: "wrong", proposals: [proposed()] }));

    expect(row.correction).toBe(undefined);
  });

  it("refuses an id the queue never proposed, and says so rather than that it was answered", () => {
    const error = unwrapErr(buildAnswer({ ...valid, proposalId: "p-0000000000009999", proposals: [proposed()] }));

    expect(error.code).toBe("PROPOSAL_NOT_OPEN");
    expect(error.message).toContain("holds no proposed belief");
  });

  it("refuses a proposal the owner has already answered, and says THAT rather than that it is missing", () => {
    const already = unwrap(buildAnswer({ ...valid, proposals: [proposed()] }));
    const error = unwrapErr(buildAnswer({ ...valid, proposals: [proposed(), already] }));

    expect(error.code).toBe("PROPOSAL_NOT_OPEN");
    expect(error.message).toContain("has already been answered");
  });

  it("refuses an empty `why`, because the row carries the owner's words and not a session's summary", () => {
    const error = unwrapErr(buildAnswer({ ...valid, proposals: [proposed()], why: "   " }));

    expect(error.code).toBe("PROPOSAL_FIELD");
    expect(error.message).toBe("why is empty");
  });

  it("refuses a `why` over its cap, so a pasted transcript is not recorded as one reaction", () => {
    const error = unwrapErr(buildAnswer({ ...valid, proposals: [proposed()], why: "x".repeat(ANSWER_WHY_MAX + 1) }));

    expect(error.code).toBe("PROPOSAL_FIELD");
    expect(error.message).toContain(`over the ${String(ANSWER_WHY_MAX)} allowed`);
  });

  it("refuses a correction longer than a claim may be, since it can become one", () => {
    const error = unwrapErr(
      buildAnswer({ ...valid, correction: "y".repeat(PROPOSAL_CLAIM_MAX + 1), proposals: [proposed()] }),
    );

    expect(error.code).toBe("PROPOSAL_FIELD");
    expect(error.message).toContain(`over the ${String(PROPOSAL_CLAIM_MAX)} allowed`);
  });

  it("round-trips through the queue's own decoder, correction and all", () => {
    const row = unwrap(
      buildAnswer({ ...valid, correction: "Gold was never built.", mark: "partly", proposals: [proposed()] }),
    );

    expect(parseProposalLine({ line: JSON.stringify(row) })).toEqual(row);
  });
});

describe("openProposals", () => {
  it("drops a proposal once the owner has answered it", () => {
    const answer = unwrap(buildAnswer({ ...valid, proposals: [proposed()] }));

    expect(openProposals({ proposals: [proposed(), answer] })).toEqual([]);
  });

  it("offers one proposal once when two sessions proposed the same claim off the same words", () => {
    const twice = [proposed(), proposed({ reviewedAtIso: LATER, run: "another-run" })];

    expect(openProposals({ proposals: twice }).map((row) => row.reviewedAtIso)).toEqual([AT]);
  });

  it("never offers a `none` row, because there is no claim in it for the owner to mark", () => {
    const nothing: BeliefProposal = {
      kind: "none",
      reviewedAtIso: AT,
      run: "half-kept-ledger-a",
      unitId: "u-ffffffffffffffff",
      why: "a scheduling message, no belief in it",
    };

    expect(openProposals({ proposals: [nothing] })).toEqual([]);
  });
});

describe("answerFor", () => {
  it("is the owner's LATEST word, because the queue is append-only and they may change their mind", () => {
    const first = unwrap(buildAnswer({ ...valid, proposals: [proposed()] }));
    const second = { ...first, mark: "wrong", reviewedAtIso: LATER, why: "actually no" } as const;

    expect(answerFor({ proposalId: "p-0123456789abcdef", proposals: [proposed(), first, second] })?.mark).toBe("wrong");
  });

  it("is undefined for a proposal the owner has not reached", () => {
    expect(answerFor({ proposalId: "p-0123456789abcdef", proposals: [proposed()] })).toBe(undefined);
  });
});
