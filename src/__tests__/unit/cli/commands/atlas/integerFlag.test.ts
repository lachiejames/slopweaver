/**
 * `integerFlagAtLeast` — the shared numeric-flag refusal the `atlas` verb family authors.
 *
 * It is shared rather than written per parser, so the cases asserting the exact sentence are the load-bearing
 * ones here: two callers drifting apart in wording is precisely what one shared refusal exists to prevent.
 * `parseReadLimit`, which lives beside it, is tested with the `atlas read` parsing that calls it.
 */
import { describe, expect, it } from "vitest";

import { AtlasCommandErrors } from "../../../../../cli/commands/atlas/errors.js";
import { integerFlagAtLeast } from "../../../../../cli/commands/atlas/integerFlag.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("integerFlagAtLeast", () => {
  it("takes the fallback when the flag was never passed", () => {
    expect(unwrap(integerFlagAtLeast({ fallback: 40, min: 1, name: "cells", raw: undefined }))).toBe(40);
  });

  it("takes the fallback for any non-string the parser hands back, rather than coercing it", () => {
    expect(unwrap(integerFlagAtLeast({ fallback: 7, min: 0, name: "max-rows", raw: true }))).toBe(7);
  });

  it("parses a whole number at the floor", () => {
    expect(unwrap(integerFlagAtLeast({ fallback: 40, min: 1, name: "cells", raw: "1" }))).toBe(1);
  });

  it("parses a whole number above the floor", () => {
    expect(unwrap(integerFlagAtLeast({ fallback: 40, min: 1, name: "cells", raw: "500" }))).toBe(500);
  });

  it("refuses the value one below the floor, naming the flag and what was typed", () => {
    const refused = unwrapErr(integerFlagAtLeast({ fallback: 40, min: 1, name: "cells", raw: "0" }));
    expect(refused).toEqual(AtlasCommandErrors.integerFlagInvalid({ min: 1, name: "cells", raw: "0" }));
    expect(refused.message).toBe(`--cells takes a whole number of 1 or more, not "0"`);
  });

  it("refuses a negative where the floor is zero", () => {
    const refused = unwrapErr(integerFlagAtLeast({ fallback: 7, min: 0, name: "max-rows", raw: "-2" }));
    expect(refused).toEqual(AtlasCommandErrors.integerFlagInvalid({ min: 0, name: "max-rows", raw: "-2" }));
    expect(refused.message).toBe(`--max-rows takes a whole number of 0 or more, not "-2"`);
  });

  it("accepts zero where the floor is zero, which is the render family's whole reason for min", () => {
    expect(unwrap(integerFlagAtLeast({ fallback: 7, min: 0, name: "max-rows", raw: "0" }))).toBe(0);
  });

  it("refuses a fraction rather than truncating it", () => {
    const refused = unwrapErr(integerFlagAtLeast({ fallback: 40, min: 1, name: "cells", raw: "1.5" }));
    expect(refused).toEqual(AtlasCommandErrors.integerFlagInvalid({ min: 1, name: "cells", raw: "1.5" }));
    expect(refused.message).toBe(`--cells takes a whole number of 1 or more, not "1.5"`);
  });

  it("refuses a word, quoting it back so the reader sees their own typo", () => {
    const refused = unwrapErr(integerFlagAtLeast({ fallback: 40, min: 1, name: "cells", raw: "lots" }));
    expect(refused).toEqual(AtlasCommandErrors.integerFlagInvalid({ min: 1, name: "cells", raw: "lots" }));
    expect(refused.message).toBe(`--cells takes a whole number of 1 or more, not "lots"`);
  });

  it('refuses the empty string, which `Number("")` would otherwise read as zero', () => {
    const refused = unwrapErr(integerFlagAtLeast({ fallback: 40, min: 1, name: "cells", raw: "" }));
    expect(refused).toEqual(AtlasCommandErrors.integerFlagInvalid({ min: 1, name: "cells", raw: "" }));
    expect(refused.message).toBe(`--cells takes a whole number of 1 or more, not ""`);
  });
});
