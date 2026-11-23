import { describe, expect, it } from "vitest";

import { parseAccessReviewArgs } from "../../../../../cli/commands/accessReview/options.js";
import { unwrap } from "../../../../../lib/result.js";

describe("parseAccessReviewArgs", () => {
  it("reads a bare platform positional on a verb that takes one", () => {
    const parsed = parseAccessReviewArgs({ rest: ["jumpcloud"], takesPlatform: true });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).platform).toBe("jumpcloud");
    expect(unwrap(parsed).json).toBe(false);
    expect(unwrap(parsed).home).toBe(undefined);
  });

  it("reads --json and --home", () => {
    const parsed = parseAccessReviewArgs({ rest: ["--json", "--home", "/tmp/x"], takesPlatform: false });
    expect(unwrap(parsed).json).toBe(true);
    expect(unwrap(parsed).home).toBe("/tmp/x");
    expect(unwrap(parsed).platform).toBe(undefined);
  });

  it("leaves the platform undefined when a verb that takes one is given none", () => {
    const parsed = parseAccessReviewArgs({ rest: [], takesPlatform: true });
    expect(unwrap(parsed).platform).toBe(undefined);
  });

  it("refuses a positional on a verb that takes none, naming what it got", () => {
    const parsed = parseAccessReviewArgs({ rest: ["jumpcloud"], takesPlatform: false });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["this verb takes no positional argument — got jumpcloud"]);
  });

  it("refuses two platforms, naming both", () => {
    const parsed = parseAccessReviewArgs({ rest: ["jumpcloud", "cloudflare"], takesPlatform: true });
    expect(parsed._unsafeUnwrapErr()).toEqual(["name at most one platform — got jumpcloud, cloudflare"]);
  });

  it("refuses an unknown flag", () => {
    const parsed = parseAccessReviewArgs({ rest: ["--nope"], takesPlatform: false });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("--nope");
  });
});
