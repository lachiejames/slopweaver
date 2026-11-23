import { describe, expect, it } from "vitest";

import { PROOF_YARN_WHY_FLAG_NAMES, parseProofYarnWhyArgs, stringFlag } from "../../../../cli/commands/proof/core.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parseProofYarnWhyArgs", () => {
  it("accepts every flag it advertises", () => {
    const parsed = parseProofYarnWhyArgs({
      rest: [
        "--dep",
        "left-pad",
        "--before",
        "/tmp/before",
        "--after",
        "/tmp/after",
        "--out",
        "/tmp/out.png",
        "--before-label",
        "staging",
        "--after-label",
        "PR branch",
      ],
    });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).values).toEqual({
      after: "/tmp/after",
      "after-label": "PR branch",
      before: "/tmp/before",
      "before-label": "staging",
      dep: "left-pad",
      out: "/tmp/out.png",
    });
  });

  it("refuses a flag it does not know", () => {
    const parsed = parseProofYarnWhyArgs({ rest: ["--dependency"] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["unknown flag: --dependency"]);
  });

  it("refuses a stray positional, because the verb takes none", () => {
    const parsed = parseProofYarnWhyArgs({ rest: ["left-pad"] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["unexpected argument: left-pad"]);
  });

  it("publishes its flag names for the help-truth ratchet", () => {
    expect(PROOF_YARN_WHY_FLAG_NAMES).toEqual([
      "--after",
      "--after-label",
      "--before",
      "--before-label",
      "--dep",
      "--out",
    ]);
  });
});

describe("stringFlag", () => {
  it("returns undefined for a flag that was not passed", () => {
    const parsed = unwrap(parseProofYarnWhyArgs({ rest: [] }));

    expect(stringFlag({ name: "dep", parsed })).toBeUndefined();
  });
});
