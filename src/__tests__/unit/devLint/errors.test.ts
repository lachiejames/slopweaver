/**
 * `DevLintInputErrors` — the typed failures a lint gate's input raises, each one sentence a runner prints
 * after its gate name.
 */
import { describe, expect, it } from "vitest";

import { DevLintInputErrors } from "../../../devLint/errors.js";

describe("DevLintInputErrors", () => {
  it("names a floor file that could not be read by its path", () => {
    const error = DevLintInputErrors.baselineUnreadable({ kind: "floor file", path: "/repo/.baselines/x.json" });

    expect(error).toEqual({
      code: "BASELINE_UNREADABLE",
      kind: "floor file",
      message: "floor file missing or unreadable at /repo/.baselines/x.json",
      path: "/repo/.baselines/x.json",
    });
  });

  it("names a debt list that could not be read in the debt list's own words", () => {
    const error = DevLintInputErrors.baselineUnreadable({ kind: "debt list", path: "/repo/.baselines/y.json" });

    expect(error.message).toBe("debt list missing or unreadable at /repo/.baselines/y.json");
  });

  it("says which offender list is the wrong shape without the `unexpected shape` phrasing", () => {
    const error = DevLintInputErrors.offenderListInvalid({ label: "help-flag-optout-baseline.json" });

    expect(error.code).toBe("OFFENDER_LIST_INVALID");
    expect(error.message).toBe('help-flag-optout-baseline.json: expected { "offenders": string[] }');
  });

  it("carries the parser's own detail after the label", () => {
    const error = DevLintInputErrors.baselineMalformed({ detail: "invalid JSON", label: "clone baseline" });

    expect(error.message).toBe("clone baseline: invalid JSON");
  });
});
