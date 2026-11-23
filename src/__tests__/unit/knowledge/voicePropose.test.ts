import { describe, expect, it } from "vitest";

import { buildNoProposal, buildProposal, quotedFrom } from "../../../knowledge/voice/propose.js";
import type { VoiceUnit } from "../../../knowledge/voice/types.js";
import { proposalId } from "../../../knowledge/voice/unit.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const AT = "2026-09-12T01:00:00.000Z";

/** The owner's real words, as the page quotes them, wrapped the way an archive turn file wraps one. */
const HIS_WORDS =
  "OWNER TURN 96-2 — verbatim:\n\n" +
  "Hey, do we ever build up that gold? I'm not actually sure.\n\n" +
  "SUPERVISOR READING (not the owner's words): the owner is asking whether the gold tier was ever built.";

const UNIT: VoiceUnit = {
  id: "u-0123456789abcdef",
  locator: "/tmp/owner-turn-gold.txt",
  occurrences: 3,
  source: "archive-turn",
  text: HIS_WORDS,
  words: 30,
  wrapped: true,
};

/** The arguments a valid proposal is built from, so each test varies exactly one thing. */
const valid = {
  claim: "The gold tier is being built up as the corpus grows.",
  domain: "slopweaver-corpus",
  held: "stated-uncertain",
  quote: "do we ever build up that gold",
  reviewedAtIso: AT,
  run: "half-kept-ledger-a",
  unit: UNIT,
} as const;

describe("quotedFrom", () => {
  it("finds a span of the owner's words", () => {
    expect(quotedFrom({ quote: "do we ever build up that gold", text: HIS_WORDS })).toBe(true);
  });

  it("tolerates only the wrapping, so a citation copied across a line break still matches", () => {
    expect(quotedFrom({ quote: "do we ever\nbuild up   that gold", text: HIS_WORDS })).toBe(true);
  });

  it("refuses a paraphrase", () => {
    expect(quotedFrom({ quote: "do we build gold up", text: HIS_WORDS })).toBe(false);
  });

  it("refuses a quote that tidies the owner's punctuation", () => {
    expect(quotedFrom({ quote: "I am not actually sure", text: HIS_WORDS })).toBe(false);
  });
});

describe("buildProposal", () => {
  it("builds a row carrying its derived id and the quote as the session wrote it", () => {
    const row = unwrap(buildProposal(valid));
    expect(row.kind).toBe("proposed");
    expect(row.unitId).toBe("u-0123456789abcdef");
    expect(row.kind === "proposed" && row.proposalId).toBe(proposalId({ claim: valid.claim, unitId: UNIT.id }));
  });

  it("stores the session's own quote rather than a re-derived span", () => {
    const row = unwrap(buildProposal({ ...valid, quote: "do we ever\nbuild up that gold" }));
    expect(row.kind === "proposed" && row.quote).toBe("do we ever\nbuild up that gold");
  });

  it("refuses a quote that is not in the owner's words, naming the code a caller branches on", () => {
    const error = unwrapErr(buildProposal({ ...valid, quote: "we should build the gold tier" }));
    expect(error.code).toBe("QUOTE_NOT_FOUND");
  });

  it("refuses an empty claim", () => {
    expect(unwrapErr(buildProposal({ ...valid, claim: "  " })).code).toBe("PROPOSAL_FIELD");
  });

  it("refuses a claim over the cap, because a belief that long is two beliefs", () => {
    const error = unwrapErr(buildProposal({ ...valid, claim: "x".repeat(401) }));
    expect(error.code).toBe("PROPOSAL_FIELD");
    expect(error.message).toContain("401");
  });

  it("refuses a domain that is not a slug", () => {
    const error = unwrapErr(buildProposal({ ...valid, domain: "Slopweaver Corpus" }));
    expect(error.code).toBe("PROPOSAL_FIELD");
    expect(error.message).toContain("domain");
  });

  it("refuses an empty quote, so a claim can never be attributed to the owner with nothing behind it", () => {
    expect(unwrapErr(buildProposal({ ...valid, quote: "" })).code).toBe("PROPOSAL_FIELD");
  });

  it("gives two sessions proposing one claim off one unit the same id", () => {
    const first = unwrap(buildProposal(valid));
    const second = unwrap(
      buildProposal({ ...valid, claim: "  THE GOLD TIER IS BEING BUILT UP AS THE CORPUS GROWS.  " }),
    );
    expect(first.kind === "proposed" && second.kind === "proposed" && first.proposalId === second.proposalId).toBe(
      true,
    );
  });
});

describe("buildNoProposal", () => {
  it("records the unit as read, with its reason", () => {
    const row = unwrap(
      buildNoProposal({ reviewedAtIso: AT, run: "r", unitId: "u-1", why: "a scheduling instruction" }),
    );
    expect(row.kind).toBe("none");
    expect(row.unitId).toBe("u-1");
  });

  it("refuses an empty reason, so a skip cannot be recorded as a review", () => {
    expect(unwrapErr(buildNoProposal({ reviewedAtIso: AT, run: "r", unitId: "u-1", why: "   " })).code).toBe(
      "PROPOSAL_FIELD",
    );
  });
});
