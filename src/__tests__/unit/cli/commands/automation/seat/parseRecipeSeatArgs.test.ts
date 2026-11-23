/**
 * `slopweaver automation seat`'s argument parse: a seat names both a bound and a model, and a bound of zero is
 * refused because a seat that takes no row is not a seat.
 */
import { describe, expect, it } from "vitest";

import { parseRecipeSeatArgs } from "../../../../../../cli/commands/automation/seatArgs.js";
import { unwrap } from "../../../../../../lib/result.js";

describe("parseRecipeSeatArgs", () => {
  it("refuses an invocation naming neither a bound nor a model, and says why for both", () => {
    const parsed = parseRecipeSeatArgs({ defaultHome: "/tmp/home", rest: [] });
    expect(parsed.isErr()).toBe(true);
    const problems = parsed._unsafeUnwrapErr();
    expect(problems.length).toBe(2);
    expect(problems[0]).toContain("--model");
    expect(problems[1]).toContain("--limit");
  });

  it("refuses a limit of zero, because a seat that takes no row is not a seat", () => {
    const parsed = parseRecipeSeatArgs({ defaultHome: "/tmp/home", rest: ["--limit", "0", "--model", "sonnet"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("at least 1");
  });

  it("resolves a complete invocation", () => {
    const parsed = parseRecipeSeatArgs({
      defaultHome: "/tmp/home",
      rest: ["--limit", "6", "--model", "sonnet", "--dry-run"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ dryRun: true, home: "/tmp/home", limit: 6, model: "sonnet", recipeId: null });
  });

  it("carries --recipe through as the one row to seat", () => {
    const parsed = parseRecipeSeatArgs({
      defaultHome: "/tmp/home",
      rest: ["--limit", "1", "--model", "opus", "--recipe", "growth-ops"],
    });
    expect(unwrap(parsed).recipeId).toBe("growth-ops");
  });
});
