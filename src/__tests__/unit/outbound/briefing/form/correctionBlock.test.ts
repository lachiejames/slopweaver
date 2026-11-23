/** The correction block: the owner-belief rows the queue projects onto the page. */
import { describe, expect, it } from "vitest";

import { OWNER_BELIEF_CLAIM_MAX_CHARS, OWNER_BELIEFS_MAX_ROWS } from "../../../../../briefing/caps.js";
import { briefingFormSchema } from "../../../../../outbound/briefing/schema.js";
import { FORM } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the correction block", () => {
  /** One projected proposal, varying only what a test overrides. */
  const belief = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    claim: "The gold tier is being built up as the corpus grows.",
    domain: "slopweaver-corpus",
    held: "stated-uncertain",
    proposalId: "p-0123456789abcdef",
    quote: "do we ever build up that gold",
    reviewedAtIso: "2026-09-12T01:00:00.000Z",
    unitId: "u-0123456789abcdef",
    wrapped: true,
    ...over,
  });

  /** A distinct proposal per index, so a test can build more of them than the cap allows. */
  const nth = ({ index }: { index: number }): Record<string, unknown> =>
    belief({ proposalId: `p-${String(index).padStart(16, "0")}` });

  it("defaults to an empty block, so a form written before the field existed still renders", () => {
    const parsed = briefingFormSchema.safeParse(FORM);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.ownerBeliefs).toEqual({ notShown: 0, rows: [] });
  });

  it("accepts a projected block", () => {
    expect(refusals({ form: { ...FORM, ownerBeliefs: { notShown: 4, rows: [belief()] } } })).toEqual([]);
  });

  it("refuses a proposal id the queue could never have written, so no answer could find it", () => {
    expect(
      refusals({ form: { ...FORM, ownerBeliefs: { notShown: 0, rows: [belief({ proposalId: "the first" })] } } })
        .length,
    ).toBe(1);
  });

  it("refuses two rows carrying the same proposal id, because the owner's answer could not say which it marks", () => {
    const issues = refusals({ form: { ...FORM, ownerBeliefs: { notShown: 0, rows: [belief(), belief()] } } });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("same proposal id");
  });

  it("refuses more rows than the cap, naming the flag that projects them", () => {
    const rows = Array.from({ length: OWNER_BELIEFS_MAX_ROWS + 1 }, (_unused, index) => nth({ index: index + 1 }));
    const issues = refusals({ form: { ...FORM, ownerBeliefs: { notShown: 0, rows } } });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain(`at most ${String(OWNER_BELIEFS_MAX_ROWS)} beliefs`);
  });

  it("refuses a claim over the queue's own bound, and accepts one exactly at it", () => {
    const at = belief({ claim: "a".repeat(OWNER_BELIEF_CLAIM_MAX_CHARS) });
    const over = belief({ claim: "a".repeat(OWNER_BELIEF_CLAIM_MAX_CHARS + 1) });

    expect(refusals({ form: { ...FORM, ownerBeliefs: { notShown: 0, rows: [at] } } })).toEqual([]);
    expect(refusals({ form: { ...FORM, ownerBeliefs: { notShown: 0, rows: [over] } } }).length).toBe(1);
  });

  it("leaves the quote uncapped, because it is the owner's own words inside a fold", () => {
    const long = belief({ quote: "b".repeat(OWNER_BELIEF_CLAIM_MAX_CHARS * 4) });

    expect(refusals({ form: { ...FORM, ownerBeliefs: { notShown: 0, rows: [long] } } })).toEqual([]);
  });

  it("refuses a hold outside the queue's two", () => {
    expect(
      refusals({ form: { ...FORM, ownerBeliefs: { notShown: 0, rows: [belief({ held: "guessed" })] } } }).length,
    ).toBe(1);
  });

  it("refuses an instant no clock can parse, since how long a belief has waited is what it asks", () => {
    const issues = refusals({
      form: { ...FORM, ownerBeliefs: { notShown: 0, rows: [belief({ reviewedAtIso: "last Tuesday" })] } },
    });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("ISO-8601");
  });

  it("refuses a negative notShown, which would claim the page shows more than the queue holds", () => {
    expect(refusals({ form: { ...FORM, ownerBeliefs: { notShown: -1, rows: [belief()] } } }).length).toBe(1);
  });
});
