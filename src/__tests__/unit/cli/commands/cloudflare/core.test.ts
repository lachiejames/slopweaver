// The --home-only reader went when every cloudflare verb moved to flagValueOr, and its cases went with it.
// deleted-with-code: parseCloudflareVerbOptions
import { describe, expect, it } from "vitest";

import { parseCloudflareSyncOptions } from "../../../../../cli/commands/cloudflare/core.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseCloudflareSyncOptions", () => {
  it("defaults every flag when none is given", () => {
    expect(unwrap(parseCloudflareSyncOptions({ defaultHome: "/default", rest: [] }))).toEqual({
      accountIdFlag: undefined,
      deepZoneFlag: undefined,
      home: "/default",
      json: false,
    });
  });

  it("reads --account-id and --deep-zone", () => {
    const result = unwrap(
      parseCloudflareSyncOptions({ defaultHome: "/default", rest: ["--account-id", "abc", "--deep-zone", "x.test"] }),
    );
    expect(result.accountIdFlag).toBe("abc");
    expect(result.deepZoneFlag).toBe("x.test");
  });

  it("reads --home over the default", () => {
    expect(unwrap(parseCloudflareSyncOptions({ defaultHome: "/default", rest: ["--home", "/x", "--json"] }))).toEqual({
      accountIdFlag: undefined,
      deepZoneFlag: undefined,
      home: "/x",
      json: true,
    });
  });

  it("rejects an unknown flag", () => {
    expect(unwrapErr(parseCloudflareSyncOptions({ defaultHome: "/default", rest: ["--nope"] })).length).toBeGreaterThan(
      0,
    );
  });
});
