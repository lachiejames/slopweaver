/**
 * Codex pricing's two failures. An invalid card keeps every problem and joins them into its message; an
 * unreadable card names its path and cause, and carries that one message as its sole problem so a renderer
 * prints one shape either way.
 */
import { describe, expect, it } from "vitest";

import { CodexPricingErrors } from "../../../codex/pricingErrors.js";

describe("CodexPricingErrors.invalid", () => {
  it("is RATE_CARD_INVALID, keeping every problem in order and joining them with a semicolon", () => {
    const error = CodexPricingErrors.invalid({
      problems: ["models.gpt-5.input is not a number", "currency is missing"],
    });

    expect(error.code).toBe("RATE_CARD_INVALID");
    expect(error.message).toBe("the rate card is not usable: models.gpt-5.input is not a number; currency is missing");
    expect(error.problems).toEqual(["models.gpt-5.input is not a number", "currency is missing"]);
  });

  it("renders a single problem with no separator", () => {
    expect(CodexPricingErrors.invalid({ problems: ["currency is missing"] }).message).toBe(
      "the rate card is not usable: currency is missing",
    );
  });
});

describe("CodexPricingErrors.unreadable", () => {
  it("is RATE_CARD_UNREADABLE, naming the path and cause, and repeating that message as its one problem", () => {
    const error = CodexPricingErrors.unreadable({ cause: "ENOENT: no such file", path: "/cards/codex.json" });

    expect(error.code).toBe("RATE_CARD_UNREADABLE");
    expect(error.path).toBe("/cards/codex.json");
    expect(error.message).toBe("could not read the rate card at /cards/codex.json: ENOENT: no such file");
    expect(error.problems).toEqual(["could not read the rate card at /cards/codex.json: ENOENT: no such file"]);
  });
});
