/**
 * `cardOutcome`: a dry run keeps the base's not-yet-run `ran`/`exitCode` and says "would post", a real run
 * sets `ran` and copies the post leg's exit code, both derive `failed` from that code, and a declared lane
 * problem rides the end of either line.
 */
import { describe, expect, it } from "vitest";

import { cardOutcome } from "../../../../../cli/commands/automation/cardOutcome.js";
import type { RowOutcome } from "../../../../../cli/commands/automation/rowRunners.js";

const BASE: Omit<RowOutcome, "line"> = {
  detail: ["capture one"],
  exitCode: null,
  failed: false,
  ran: false,
  recipeId: "alert-digest",
};

const LEGS = "slack post --form card.json";

describe("cardOutcome", () => {
  it("a successful dry run keeps ran false and exitCode null and says it would post", () => {
    expect(
      cardOutcome({
        base: BASE,
        diagnostics: "",
        dryRun: true,
        legs: LEGS,
        posted: 0,
        problem: undefined,
        recipeId: "alert-digest",
      }),
    ).toEqual({
      detail: ["capture one"],
      exitCode: null,
      failed: false,
      line: "recipe alert-digest · would post · slack post --form card.json --dry-run · exit 0",
      ran: false,
      recipeId: "alert-digest",
    });
  });

  it("a dry run whose post leg exits non-zero is failed without claiming it ran", () => {
    const outcome = cardOutcome({
      base: BASE,
      diagnostics: "",
      dryRun: true,
      legs: LEGS,
      posted: 2,
      problem: undefined,
      recipeId: "alert-digest",
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.ran).toBe(false);
    expect(outcome.exitCode).toBe(null);
    expect(outcome.line).toBe("recipe alert-digest · would post · slack post --form card.json --dry-run · exit 2");
  });

  it("a real successful run sets ran and copies exit code zero", () => {
    expect(
      cardOutcome({
        base: BASE,
        diagnostics: "",
        dryRun: false,
        legs: LEGS,
        posted: 0,
        problem: undefined,
        recipeId: "alert-digest",
      }),
    ).toEqual({
      detail: ["capture one"],
      exitCode: 0,
      failed: false,
      line: "recipe alert-digest · ran · slack post --form card.json · exit 0",
      ran: true,
      recipeId: "alert-digest",
    });
  });

  it("a real failed run sets ran, copies the non-zero exit code and is failed", () => {
    const outcome = cardOutcome({
      base: BASE,
      diagnostics: "",
      dryRun: false,
      legs: LEGS,
      posted: 1,
      problem: undefined,
      recipeId: "alert-digest",
    });
    expect(outcome.ran).toBe(true);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.failed).toBe(true);
    expect(outcome.line).toBe("recipe alert-digest · ran · slack post --form card.json · exit 1");
  });

  it("a failed post's stderr tail is appended after the lane problem, so the reason is saved with the line", () => {
    const outcome = cardOutcome({
      base: BASE,
      diagnostics: "slack post: channel_not_found\n",
      dryRun: false,
      legs: LEGS,
      posted: 1,
      problem: "recommendations lane dropped",
      recipeId: "alert-digest",
    });
    expect(outcome.line).toBe(
      "recipe alert-digest · ran · slack post --form card.json · exit 1 · recommendations lane dropped" +
        " · why: slack post: channel_not_found",
    );
  });

  it("a successful post's stderr is never appended, whatever it wrote", () => {
    const outcome = cardOutcome({
      base: BASE,
      diagnostics: "slack post: posted 1790.0002\n",
      dryRun: false,
      legs: LEGS,
      posted: 0,
      problem: undefined,
      recipeId: "alert-digest",
    });
    expect(outcome.line).toBe("recipe alert-digest · ran · slack post --form card.json · exit 0");
  });

  it("a declared lane problem is appended to a real run's line", () => {
    const outcome = cardOutcome({
      base: BASE,
      diagnostics: "",
      dryRun: false,
      legs: LEGS,
      posted: 0,
      problem: "recommendations lane dropped: no set supplies it",
      recipeId: "alert-digest",
    });
    expect(outcome.line).toBe(
      "recipe alert-digest · ran · slack post --form card.json · exit 0 · recommendations lane dropped: no set supplies it",
    );
  });

  it("a declared lane problem is appended to a dry run's line", () => {
    const outcome = cardOutcome({
      base: BASE,
      diagnostics: "",
      dryRun: true,
      legs: LEGS,
      posted: 0,
      problem: "recommendations lane dropped",
      recipeId: "alert-digest",
    });
    expect(outcome.line).toBe(
      "recipe alert-digest · would post · slack post --form card.json --dry-run · exit 0 · recommendations lane dropped",
    );
  });
});
