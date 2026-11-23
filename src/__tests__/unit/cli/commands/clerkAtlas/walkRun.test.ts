/**
 * The Clerk walk's flag parse: where the instance root comes from is decided once, as a named arm, so no
 * `null` root leaves the parse — a `--root` the invocation supplied, or the walk's own discovery.
 */
import { describe, expect, it } from "vitest";

import { parseWalkOptions } from "../../../../../cli/commands/clerkAtlas/walkRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const ROOT = "/apps/app_0SYNFIXTUREAPP0000000000000/instances/ins_0SYNFIXTUREINS0000000000000";

describe("parseWalkOptions", () => {
  it("names discovery as the seed when no --root was passed", () => {
    expect(unwrap(parseWalkOptions({ rest: ["--home", "/h"] }))).toEqual({
      home: "/h",
      json: false,
      seed: { from: "discover" },
    });
  });

  it("carries a well-formed --root as the flag arm", () => {
    expect(unwrap(parseWalkOptions({ rest: ["--home", "/h", "--root", ROOT, "--json"] }))).toEqual({
      home: "/h",
      json: true,
      seed: { from: "flag", root: ROOT },
    });
  });

  it("refuses a malformed --root, quoting it and the shape it wanted", () => {
    expect(unwrapErr(parseWalkOptions({ rest: ["--home", "/h", "--root", "/apps/x"] }))).toEqual([
      '--root must read /apps/<application>/instances/<instance>, exactly as the dashboard\'s own address does; got "/apps/x"',
    ]);
  });
});
