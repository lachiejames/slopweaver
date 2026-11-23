import { describe, expect, it } from "vitest";

import { AtlasCommandErrors } from "../../../../../cli/commands/atlas/errors.js";
import { ATLAS_RESET_CONFIRMATION, parseAtlasResetOptions } from "../../../../../cli/commands/atlas/resetOptions.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("ATLAS_RESET_CONFIRMATION", () => {
  it("is the word naming what reset does", () => {
    expect(ATLAS_RESET_CONFIRMATION).toBe("archive");
  });
});

describe("parseAtlasResetOptions", () => {
  it("accepts the exact confirmation word and returns the explicit home and the json flag", () => {
    const result = parseAtlasResetOptions({ rest: ["--confirm", "archive", "--home", "/explicit-home", "--json"] });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({ home: "/explicit-home", json: true });
  });

  it("reads json as false when the flag is absent", () => {
    const result = parseAtlasResetOptions({ rest: ["--home", "/explicit-home", "--confirm", "archive"] });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({ home: "/explicit-home", json: false });
  });

  it("refuses a tail with no confirmation, naming the word it needs", () => {
    const result = parseAtlasResetOptions({ rest: ["--home", "/explicit-home"] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(AtlasCommandErrors.resetEmptyConfirmRequired({ word: "archive" }));
    expect(unwrapErr(result).message).toContain("archive");
  });

  it("refuses a mistyped confirmation word as a mismatch carrying both words", () => {
    const result = parseAtlasResetOptions({ rest: ["--confirm", "delete", "--home", "/explicit-home"] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(AtlasCommandErrors.confirmMismatch({ confirm: "delete", expected: "archive" }));
    expect(unwrapErr(result)).toEqual({
      code: "CONFIRM_MISMATCH",
      confirm: "delete",
      expected: "archive",
      message: '--confirm must be exactly "archive", not "delete"',
    });
  });

  it("refuses a confirmation that differs only in case, since the check is exact", () => {
    const result = parseAtlasResetOptions({ rest: ["--confirm", "Archive", "--home", "/explicit-home"] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("CONFIRM_MISMATCH");
  });

  it("refuses an unknown flag as FLAGS_INVALID before any home is resolved", () => {
    const result = parseAtlasResetOptions({ rest: ["--confirm", "archive", "--force"] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(AtlasCommandErrors.flagsInvalid({ reasons: ["unknown flag: --force"] }));
    expect(unwrapErr(result).code).toBe("FLAGS_INVALID");
  });
});
