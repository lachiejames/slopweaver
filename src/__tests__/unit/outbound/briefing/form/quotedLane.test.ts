/** The quoted lane: a note whose fold holds a record, judged on its headline and never on its fold's words. */
import { describe, expect, it } from "vitest";

import { FORM, text } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the quoted lane: a note whose fold holds a record rather than composed prose", () => {
  /** A fold carrying text a composer would be refused for writing. */
  const RECORDED = {
    blocks: [
      {
        content: text({ value: "they wrote 1. this 2. that 3. and the other, then trailed off…" }),
        kind: "para" as const,
      },
    ],
    summary: "each one, exactly as it was recorded",
  };

  it("accepts a quoted note carrying a detail the composed fold refuses", () => {
    const earlierToday = {
      notes: [{ detail: RECORDED, headline: text({ value: "3 things recorded" }), lane: "quoted" as const }],
      summary: "what was recorded on this day",
    };

    expect(refusals({ form: { ...FORM, earlierToday } })).toEqual([]);
  });

  it("refuses the same detail with no lane, because a composer wrote that one", () => {
    const earlierToday = {
      notes: [{ detail: RECORDED, headline: text({ value: "3 things recorded" }) }],
      summary: "what was recorded on this day",
    };

    expect(refusals({ form: { ...FORM, earlierToday } })).not.toEqual([]);
  });

  it("refuses a lane it does not know, so the union can never be widened by a typo", () => {
    const earlierToday = {
      notes: [{ headline: text({ value: "3 things recorded" }), lane: "verbatim" }],
      summary: "what was recorded on this day",
    };

    expect(refusals({ form: { ...FORM, earlierToday } })).not.toEqual([]);
  });

  it("still judges a quoted note's own HEADLINE, which the projection composed", () => {
    const earlierToday = {
      notes: [{ detail: RECORDED, headline: text({ value: "This tick closed the chair." }), lane: "quoted" as const }],
      summary: "what was recorded on this day",
    };

    expect(refusals({ form: { ...FORM, earlierToday } })).toEqual([
      'earlierToday.notes: "what was recorded on this day" uses the fleet word "This tick" and never says ' +
        'what it means — "tick" here is one pass of the supervisor\'s loop. Say what it means in the same ' +
        "breath, above the fold, or write the card without the word.",
    ]);
  });

  it("does not judge the WORDS inside a quoted note's fold, which nobody here wrote", () => {
    const earlierToday = {
      notes: [
        {
          detail: {
            blocks: [{ content: text({ value: "This tick closed the chair." }), kind: "para" as const }],
            summary: "each one, exactly as it was recorded",
          },
          headline: text({ value: "1 thing recorded" }),
          lane: "quoted" as const,
        },
      ],
      summary: "what was recorded on this day",
    };

    expect(refusals({ form: { ...FORM, earlierToday } })).toEqual([]);
  });

  it("keeps `recent` on the composed arm, since landings are composed here", () => {
    const recent = [{ headline: text({ value: "one landing" }), lane: "quoted" }];

    expect(refusals({ form: { ...FORM, recent } })).not.toEqual([]);
  });
});
