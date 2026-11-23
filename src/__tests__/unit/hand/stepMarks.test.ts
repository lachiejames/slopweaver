import { describe, expect, it } from "vitest";

import { HandStepErrors } from "../../../hand/errors.js";
import type { HandStepDraft } from "../../../hand/step.js";
import { checkedMarks, markPieces } from "../../../hand/stepMarks.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/**
 * A draft carrying only the marks a case sets.
 *
 * @param over the marks the case sets
 * @returns the draft
 */
function draft(over: Partial<HandStepDraft> = {}): HandStepDraft {
  return {
    id: "a-step",
    postedBy: "workspace:1",
    postedIso: "2026-09-27T08:00:00.000Z",
    unblocks: "the run",
    what: "Sign in",
    witness: "slopweaver hand done a-step",
    ...over,
  };
}

describe("checkedMarks", () => {
  it("carries no mark a draft did not supply", () => {
    expect(unwrap(checkedMarks({ draft: draft() }))).toEqual({});
  });

  it("carries every mark a draft supplied, as supplied", () => {
    expect(unwrap(checkedMarks({ draft: draft({ checkIn: true, context: "work", row: "a-board-row" }) }))).toEqual({
      checkIn: true,
      context: "work",
      row: "a-board-row",
    });
  });

  it("refuses a row that is not a slug the run store could open, rather than reading it as no row", () => {
    expect(unwrapErr(checkedMarks({ draft: draft({ row: "../escape" }) })).code).toBe("INVALID_FIELD");
    expect(unwrapErr(checkedMarks({ draft: draft({ row: 7 }) })).message).toContain("row");
  });

  it("refuses a row slug past the cap", () => {
    expect(unwrapErr(checkedMarks({ draft: draft({ row: "r".repeat(201) }) })).message).toContain("at most 200");
    expect(unwrap(checkedMarks({ draft: draft({ row: "r".repeat(200) }) })).row).toBe("r".repeat(200));
  });

  it("refuses a check-in of false, which nothing writes", () => {
    expect(unwrapErr(checkedMarks({ draft: draft({ checkIn: false }) }))).toEqual(
      HandStepErrors.invalidField({
        field: "checkIn",
        why: "is `true` or absent — `hand post --check-in` is the only thing that writes it",
      }),
    );
  });

  it("names the context first when more than one mark is wrong", () => {
    expect(unwrapErr(checkedMarks({ draft: draft({ checkIn: false, context: "home", row: 7 }) })).message).toContain(
      "context",
    );
  });
});

describe("markPieces", () => {
  it("gives an empty piece for every absent mark", () => {
    expect(markPieces({ marks: {} })).toEqual({ checkIn: {}, context: {}, notice: {}, row: {}, stopsWork: {} });
  });

  it("gives each present mark its own piece, keyed by itself", () => {
    expect(
      markPieces({ marks: { checkIn: true, context: "work", notice: true, row: "a-row", stopsWork: true } }),
    ).toEqual({
      checkIn: { checkIn: true },
      context: { context: "work" },
      notice: { notice: true },
      row: { row: "a-row" },
      stopsWork: { stopsWork: true },
    });
  });
});
