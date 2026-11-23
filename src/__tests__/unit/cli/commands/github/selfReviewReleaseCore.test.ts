import { describe, expect, it } from "vitest";

import { parseGithubSelfReviewReleaseArgs } from "../../../../../cli/commands/github/selfReviewReleaseCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubSelfReviewReleaseArgs", () => {
  it("resolves the repository, pull-request number and optional head", () => {
    const parsed = parseGithubSelfReviewReleaseArgs({
      rest: ["--repo", "o/r", "--pr", "7", "--head", "abc123", "--home", "/state"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ head: "abc123", home: "/state", number: 7, owner: "o", repo: "r" });
  });

  it("defaults head and home to undefined when omitted", () => {
    const parsed = parseGithubSelfReviewReleaseArgs({ rest: ["--repo", "o/r", "--pr", "7"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ head: undefined, home: undefined, number: 7, owner: "o", repo: "r" });
  });

  it("refuses a missing repo and a non-positive pull-request number together", () => {
    const parsed = parseGithubSelfReviewReleaseArgs({ rest: ["--pr", "0"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["--repo owner/name is required", "--pr must be a positive whole number"]);
  });

  it("refuses an unknown flag", () => {
    const parsed = parseGithubSelfReviewReleaseArgs({ rest: ["--repo", "o/r", "--pr", "7", "--bogus", "x"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toContain("unknown flag: --bogus");
  });
});
