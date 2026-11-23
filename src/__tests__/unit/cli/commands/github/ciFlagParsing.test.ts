import { describe, expect, it } from "vitest";

import { ciFlagNames, ciPositiveInteger, ciTextFlag } from "../../../../../cli/commands/github/ciFlagParsing.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("ciFlagNames", () => {
  it("prefixes every name with the dashes a caller types, strings before booleans", () => {
    expect(ciFlagNames({ booleans: ["json"], strings: ["repo", "home"] })).toEqual(["--repo", "--home", "--json"]);
  });

  it("answers an empty list for a verb declaring no flags", () => {
    expect(ciFlagNames({ booleans: [], strings: [] })).toEqual([]);
  });
});

describe("ciTextFlag", () => {
  it("takes the fallback when the flag was not typed at all", () => {
    expect(unwrap(ciTextFlag({ fallback: "main", flag: "branch", value: undefined }))).toBe("main");
  });

  it("trims a value rather than carrying a caller's whitespace into a url", () => {
    expect(unwrap(ciTextFlag({ fallback: "main", flag: "branch", value: "  dev  " }))).toBe("dev");
  });

  it("REFUSES a blank value instead of silently falling back to the default", () => {
    const issues = unwrapErr(ciTextFlag({ fallback: "main", flag: "branch", value: "   " }));
    expect(issues.map((issue) => issue.code)).toEqual(["BLANK_FLAG_VALUE"]);
    expect(issues[0]!.message).toContain("--branch");
  });

  it("refuses a bare boolean flag typed where a value belongs", () => {
    const issues = unwrapErr(ciTextFlag({ fallback: "main", flag: "branch", value: true }));
    expect(issues.map((issue) => issue.code)).toEqual(["BLANK_FLAG_VALUE"]);
  });

  it("REFUSES a trimmed value that begins with --, which is accepted here and refused on the way back in", () => {
    const issues = unwrapErr(ciTextFlag({ fallback: "main", flag: "baseline", value: " --baseline.json" }));
    expect(issues.map((issue) => issue.code)).toEqual(["FLAG_VALUE_LOOKS_LIKE_FLAG"]);
    expect(issues[0]!.message).toContain("--baseline was given --baseline.json");
  });

  it("takes a single leading dash, which a command line carries back without splitting", () => {
    expect(unwrap(ciTextFlag({ fallback: "main", flag: "baseline", value: "-baseline.json" }))).toBe("-baseline.json");
  });
});

describe("ciPositiveInteger", () => {
  it("reports an untyped flag as absent, leaving the verb to decide what that means", () => {
    expect(ciPositiveInteger({ max: undefined, value: undefined })).toEqual({ kind: "absent" });
  });

  it("reads a positive integer", () => {
    expect(ciPositiveInteger({ max: undefined, value: "42" })).toEqual({ kind: "present", value: 42 });
  });

  it("refuses zero and a negative, which a truthiness check would have taken", () => {
    expect(ciPositiveInteger({ max: undefined, value: "0" })).toEqual({ kind: "invalid" });
    expect(ciPositiveInteger({ max: undefined, value: "-3" })).toEqual({ kind: "invalid" });
  });

  it("refuses a fraction, because every flag on these verbs counts whole things", () => {
    expect(ciPositiveInteger({ max: undefined, value: "1.5" })).toEqual({ kind: "invalid" });
  });

  it("refuses text and a bare boolean flag", () => {
    expect(ciPositiveInteger({ max: undefined, value: "twenty" })).toEqual({ kind: "invalid" });
    expect(ciPositiveInteger({ max: undefined, value: true })).toEqual({ kind: "invalid" });
  });

  it("refuses past a ceiling rather than clamping to it", () => {
    expect(ciPositiveInteger({ max: 100, value: "101" })).toEqual({ kind: "invalid" });
    expect(ciPositiveInteger({ max: 100, value: "100" })).toEqual({ kind: "present", value: 100 });
  });
});
