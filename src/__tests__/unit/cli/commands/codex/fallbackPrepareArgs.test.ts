/**
 * `codex review-fallback prepare`'s flag reads: a complete set becomes one typed value, and any gap is the one
 * failure naming every flag the sub-verb requires.
 */
import { describe, expect, it } from "vitest";

import { preparePrepareArgs, stringFlag } from "../../../../../cli/commands/codex/fallbackPrepareArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** Every flag `prepare` requires, a case overriding the one it is about. */
const COMPLETE: Readonly<Record<string, string>> = {
  base: "origin/main",
  "max-diff-bytes": "2048",
  pass: "r2",
  property: "a landed leftover is named in the body",
  "property-id": "r2-01",
};

describe("preparePrepareArgs", () => {
  it("reads a complete flag set into one typed value", () => {
    expect(unwrap(preparePrepareArgs({ parsed: { positionals: [], values: COMPLETE } }))).toEqual({
      base: "origin/main",
      maxDiffBytes: 2048,
      pass: "r2",
      property: { id: "r2-01", statement: "a landed leftover is named in the body" },
    });
  });

  it("refuses a pass that is not a review pass", () => {
    const parsed = { positionals: [], values: { ...COMPLETE, pass: "p1" } };
    expect(unwrapErr(preparePrepareArgs({ parsed })).code).toBe("PREPARE_FLAGS_MISSING");
  });

  it("refuses a diff budget that is not a positive integer", () => {
    const parsed = { positionals: [], values: { ...COMPLETE, "max-diff-bytes": "0" } };
    expect(unwrapErr(preparePrepareArgs({ parsed })).code).toBe("PREPARE_FLAGS_MISSING");
  });
});

describe("stringFlag", () => {
  it("reads a blank value as not given", () => {
    expect(stringFlag({ name: "base", parsed: { positionals: [], values: { base: "   " } } })).toBeUndefined();
  });

  it("reads a boolean flag as not a string", () => {
    expect(stringFlag({ name: "json", parsed: { positionals: [], values: { json: true } } })).toBeUndefined();
  });
});
