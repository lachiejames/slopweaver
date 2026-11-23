/*
 * `parseReadLimit`: a whole number from 1 to 1000 passes, anything else is refused with the accepted range named.
 */
import { describe, expect, it } from "vitest";

import { AtlasCommandErrors } from "../../../../../../cli/commands/atlas/errors.js";
import { parseReadLimit } from "../../../../../../cli/commands/atlas/integerFlag.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";

describe("parseReadLimit", () => {
  it("accepts a whole number in range", () => {
    expect(unwrap(parseReadLimit({ raw: "250" }))).toBe(250);
  });

  it("refuses zero, a fraction, and anything past the ceiling", () => {
    expect(unwrapErr(parseReadLimit({ raw: "0" }))).toEqual(
      AtlasCommandErrors.readLimitInvalid({ max: 1000, min: 1, raw: "0" }),
    );
    expect(unwrapErr(parseReadLimit({ raw: "0" })).message).toBe(
      "--limit must be a whole number from 1 to 1000, got: 0",
    );
    expect(unwrapErr(parseReadLimit({ raw: "2.5" }))).toEqual(
      AtlasCommandErrors.readLimitInvalid({ max: 1000, min: 1, raw: "2.5" }),
    );
    expect(unwrapErr(parseReadLimit({ raw: "2.5" })).message).toBe(
      "--limit must be a whole number from 1 to 1000, got: 2.5",
    );
    expect(unwrapErr(parseReadLimit({ raw: "1001" }))).toEqual(
      AtlasCommandErrors.readLimitInvalid({ max: 1000, min: 1, raw: "1001" }),
    );
    expect(unwrapErr(parseReadLimit({ raw: "1001" })).message).toBe(
      "--limit must be a whole number from 1 to 1000, got: 1001",
    );
    expect(unwrapErr(parseReadLimit({ raw: "many" }))).toEqual(
      AtlasCommandErrors.readLimitInvalid({ max: 1000, min: 1, raw: "many" }),
    );
    expect(unwrapErr(parseReadLimit({ raw: "many" })).message).toBe(
      "--limit must be a whole number from 1 to 1000, got: many",
    );
  });

  it("names the accepted range rather than saying only that it was wrong", () => {
    const refused = parseReadLimit({ raw: "5000" });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("READ_LIMIT_INVALID");
    expect(refused._unsafeUnwrapErr().message).toBe("--limit must be a whole number from 1 to 1000, got: 5000");
  });
});
