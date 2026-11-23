/**
 * `tickArgParts.ts`: the missing-flag refusal and the tick-number parse every `supervisor tick` subaction shares.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { missing, tickNumberOf } from "../../../../../cli/commands/supervisor/tickArgParts.js";

describe("missing", () => {
  it("names the subaction and the flag with its dashes", () => {
    const error = missing({ flag: "slug", subaction: "fill" });
    expect(error.code).toBe("USAGE");
    expect(error.message).toBe("tick fill: --slug is required");
  });
});

describe("tickNumberOf", () => {
  it("is undefined when the flag was not passed", () => {
    const result = tickNumberOf({ raw: undefined });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBeUndefined();
  });

  it.each([
    ["1", 1],
    ["42", 42],
    ["9999999", 9999999],
  ])("parses `%s` as %s", (raw, expected) => {
    const result = tickNumberOf({ raw });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(expected);
  });

  it.each(["0", "-1", "01", "1.5", "abc", "", "12345678"])("refuses `%s`", (raw) => {
    const result = tickNumberOf({ raw });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe(`--tick ${raw} must be a positive whole number`);
  });
});
