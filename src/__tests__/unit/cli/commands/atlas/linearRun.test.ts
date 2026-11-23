/**
 * How `atlas linear sync|walk` reads `--limit`.
 *
 * The verbs themselves reach a Linear token, the network, the owner's Chrome and the real clock, so only the
 * extracted `parseLinearLimit` is exercised here.
 */
import { describe, expect, it } from "vitest";

import { AtlasCommandErrors } from "../../../../../cli/commands/atlas/errors.js";
import { parseLinearLimit } from "../../../../../cli/commands/atlas/linearRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseLinearLimit", () => {
  it("reads an absent flag as no limit", () => {
    const parsed = parseLinearLimit({ raw: undefined });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toBe(null);
  });

  it("accepts 1 and refuses 0 with LINEAR_LIMIT_INVALID", () => {
    const one = parseLinearLimit({ raw: "1" });
    expect(one.isOk()).toBe(true);
    expect(unwrap(one)).toBe(1);

    const zero = parseLinearLimit({ raw: "0" });
    expect(zero.isErr()).toBe(true);
    const error = unwrapErr(zero);
    expect(error).toEqual(AtlasCommandErrors.linearLimitInvalid());
    expect(error.code).toBe("LINEAR_LIMIT_INVALID");
    expect(error.message).toBe("--limit takes a positive integer");
  });

  it("refuses a value with no leading digits with LINEAR_LIMIT_INVALID", () => {
    const parsed = parseLinearLimit({ raw: "abc" });
    expect(parsed.isErr()).toBe(true);
    const error = unwrapErr(parsed);
    expect(error).toEqual(AtlasCommandErrors.linearLimitInvalid());
    expect(error.code).toBe("LINEAR_LIMIT_INVALID");
  });

  it("reads the leading digits of a value with a trailing remainder, as Number.parseInt does", () => {
    expect(unwrap(parseLinearLimit({ raw: "2x" }))).toBe(2);
    expect(unwrap(parseLinearLimit({ raw: "1.5" }))).toBe(1);
  });
});
