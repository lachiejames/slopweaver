import { describe, expect, it } from "vitest";

import { parsePolicyDiff } from "../../../../cli/commands/policy/diffCore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parsePolicyDiff", () => {
  it("reads the record, the output directory and the default home", () => {
    expect(unwrap(parsePolicyDiff({ defaultHome: "/h", rest: ["--record", "r.json", "--out", "o"] }))).toEqual({
      home: "/h",
      json: false,
      out: "o",
      record: "r.json",
    });
  });

  it("takes --home and --json", () => {
    const options = unwrap(
      parsePolicyDiff({ defaultHome: "/h", rest: ["--record", "r", "--out", "o", "--home", "/x", "--json"] }),
    );
    expect([options.home, options.json]).toEqual(["/x", true]);
  });

  it("names both missing flags at once", () => {
    expect(unwrapErr(parsePolicyDiff({ defaultHome: "/h", rest: [] }))).toEqual([
      "--record <path> is required: the diff record naming each document's two sides and every reason",
      "--out <dir> is required: where the owner page, the team page and the team post are written",
    ]);
  });
});
