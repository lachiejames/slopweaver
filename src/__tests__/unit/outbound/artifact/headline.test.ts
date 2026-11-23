import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  HEADLINE_CLAUSES_MAX,
  HEADLINE_SEPARATOR,
  HEADLINE_VISIBLE_MAX,
  headlineOf,
  renderHeadline,
} from "../../../../outbound/artifact/headline.js";
import { TLDR_VISIBLE_MAX } from "../../../../outbound/assistant/contentLimits.js";

/** Every message the refusal produced, joined, so one assertion can name the fragment it wants. */
function refusalOf({ clauses }: { clauses: readonly string[] }): string {
  const result = headlineOf({ clauses });
  expect(result.isErr()).toBe(true);
  return result._unsafeUnwrapErr().join(" | ");
}

describe("renderHeadline", () => {
  it("renders one clause as itself, with no separator anywhere near it", () => {
    expect(renderHeadline({ headline: { clauses: ["ISO 27001 control completion 68.4%."] } })).toBe(
      "ISO 27001 control completion 68.4%.",
    );
  });

  it("joins two clauses with the one separator, spaced", () => {
    expect(renderHeadline({ headline: { clauses: ["a-doc is blocked on you", "waiting 3.0h"] } })).toBe(
      `a-doc is blocked on you ${HEADLINE_SEPARATOR} waiting 3.0h`,
    );
  });

  it("joins three clauses with two separators", () => {
    expect(renderHeadline({ headline: { clauses: ["one", "two", "three"] } })).toBe(
      `one ${HEADLINE_SEPARATOR} two ${HEADLINE_SEPARATOR} three`,
    );
  });
});

describe("headlineOf", () => {
  it("returns the rendered line for clauses it accepts", () => {
    expect(unwrap(headlineOf({ clauses: ["2 blocked on you", "1 closed"] }))).toBe(
      `2 blocked on you ${HEADLINE_SEPARATOR} 1 closed`,
    );
  });

  it("drops an empty clause rather than rendering a headline that ends in a separator", () => {
    expect(unwrap(headlineOf({ clauses: ["2 blocked on you", "", "   "] }))).toBe("2 blocked on you");
  });

  it("trims a clause before rendering it", () => {
    expect(unwrap(headlineOf({ clauses: ["  2 blocked on you  ", " 1 closed "] }))).toBe(
      `2 blocked on you ${HEADLINE_SEPARATOR} 1 closed`,
    );
  });

  it("refuses an em dash and names the field boundary as where the second idea goes", () => {
    const message = refusalOf({ clauses: ["a-doc is blocked on you — waiting 3.0h"] });
    expect(message).toContain('a headline clause cannot contain "—"');
    expect(message).toContain("Split the clause in two and let the renderer join them");
  });

  it("refuses an en dash", () => {
    expect(refusalOf({ clauses: ["a – b"] })).toContain('a headline clause cannot contain "–"');
  });

  it("refuses the renderer's own separator, so nobody does the joining by hand", () => {
    expect(refusalOf({ clauses: [`a ${HEADLINE_SEPARATOR} b`] })).toContain(
      `a headline clause cannot contain "${HEADLINE_SEPARATOR}"`,
    );
  });

  it("refuses a pipe", () => {
    expect(refusalOf({ clauses: ["a | b"] })).toContain('a headline clause cannot contain "|"');
  });

  it("accepts a hyphen, which is a word's own punctuation rather than a separator", () => {
    expect(unwrap(headlineOf({ clauses: ["re-run the sweep"] }))).toBe("re-run the sweep");
  });

  it("refuses a headline with no clauses at all", () => {
    expect(refusalOf({ clauses: [] })).toContain("Too small");
  });

  it("refuses more clauses than a headline carries", () => {
    expect(refusalOf({ clauses: ["one", "two", "three", "four"] })).toContain("Too big");
  });

  it("accepts exactly the declared maximum number of clauses", () => {
    const clauses = Array.from({ length: HEADLINE_CLAUSES_MAX }, (_unused, index) => `clause ${String(index)}`);
    expect(unwrap(headlineOf({ clauses })).split(HEADLINE_SEPARATOR)).toHaveLength(HEADLINE_CLAUSES_MAX);
  });
});

/** The second clause of the maximal fixture. Any width does; the first is then derived to land on the cap. */
const SECOND = 40;

/** The first clause's width, derived so that first + joiner + second is EXACTLY the cap. */
const WIDEST_FIRST = HEADLINE_VISIBLE_MAX - 3 - SECOND;

describe("the width promise", () => {
  it("bounds the headline at the layout's own TL;DR cap", () => {
    expect(HEADLINE_VISIBLE_MAX).toBe(TLDR_VISIBLE_MAX);
  });

  it("accepts the widest headline that fits, joiners counted", () => {
    // Two clauses plus one three-unit joiner, sized so the rendered line lands EXACTLY on the cap.
    const rendered = unwrap(headlineOf({ clauses: ["a".repeat(WIDEST_FIRST), "b".repeat(SECOND)] }));
    expect(rendered.length).toBe(HEADLINE_VISIBLE_MAX);
  });

  it("refuses the one that is a character wider, and says what the joiners cost", () => {
    const message = refusalOf({ clauses: ["a".repeat(WIDEST_FIRST + 1), "b".repeat(SECOND)] });
    expect(message).toContain(`render to ${String(HEADLINE_VISIBLE_MAX + 1)} visible characters`);
    expect(message).toContain("each one costs 3");
  });

  it("refuses a single clause wider than the whole line", () => {
    expect(refusalOf({ clauses: ["a".repeat(HEADLINE_VISIBLE_MAX + 1)] })).toContain("Too big");
  });
});
