/*
 * The failure-explanations register's error factories live in their own module and join `RecipeErrors` whole, so a
 * caller raising one through either name gets the same value.
 */
import { describe, expect, it } from "vitest";

import { RecipeErrors } from "../../../../live/automation/errors.js";
import { RecipeExplanationErrors } from "../../../../live/automation/explanationErrors.js";

describe("RecipeExplanationErrors", () => {
  it("joins RecipeErrors as the same factories", () => {
    expect(Object.keys(RecipeExplanationErrors).length).toBeGreaterThan(0);
    expect(
      Object.entries(RecipeExplanationErrors)
        .filter(([name, factory]) => RecipeErrors[name as keyof typeof RecipeErrors] !== factory)
        .map(([name]) => name),
    ).toEqual([]);
  });

  it("names the firing and what it was found to be when it is not a failure", () => {
    const error = RecipeExplanationErrors.explanationNotAFailure({
      attempt: 2,
      found: "succeeded",
      recipeId: "acme-digest",
      slotIso: "2026-11-03T09:00:00.000Z",
    });
    expect([error.code, error.message]).toEqual([
      "EXPLANATION_NOT_A_FAILURE",
      "acme-digest's firing at 2026-11-03T09:00:00.000Z attempt 2 is succeeded, not a failure, so no explanation is filed",
    ]);
  });

  it("says the length and the cap when the words are too long", () => {
    const error = RecipeExplanationErrors.explanationWordsTooLong({ cap: 140, length: 200 });
    expect([error.code, error.fault, error.message]).toEqual([
      "EXPLANATION_WORDS_UNFIT",
      "TOO_LONG",
      "the explanation is 200 characters, over the 140 a row's subtitle holds: say it shorter, the raw record stays in the firing",
    ]);
  });

  it("names the character outside the shape quoted, or the malformed word when no character is", () => {
    const named = RecipeExplanationErrors.explanationWordsOutsideShape({ found: '"' });
    const unnamed = RecipeExplanationErrors.explanationWordsOutsideShape({ found: undefined });
    const tail =
      ", which a plain sentence here does not: words and numbers one space apart, joined only by an apostrophe or " +
      "hyphen, with commas and one closing stop, so say a code, a path, a quote or a bracket in words";
    expect([named.code, named.fault, named.message, unnamed.message]).toEqual([
      "EXPLANATION_WORDS_UNFIT",
      "OUTSIDE_SHAPE",
      `the explanation carries "\\""${tail}`,
      `the explanation carries a word or number out of shape${tail}`,
    ]);
  });
});
