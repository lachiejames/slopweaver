import { describe, expect, it } from "vitest";

import { labelDoorRequest, parseGithubLabelArgs } from "../../../../../cli/commands/github/labelCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubLabelArgs", () => {
  it("requires one exact repository, number and at least one label", () => {
    expect(unwrap(parseGithubLabelArgs({ rest: ["--repo", "o/r", "--number", "7", "--add", "e2e-local"] }))).toEqual({
      add: ["e2e-local"],
      dryRun: false,
      home: undefined,
      json: false,
      number: 7,
      owner: "o",
      repo: "r",
    });
    expect(unwrapErr(parseGithubLabelArgs({ rest: ["--repo", "broken", "--number", "0"] }))).toEqual([
      "--repo owner/name is required",
      "--number must be a positive whole number",
      "--add needs at least one label name",
    ]);
  });

  it("splits --add on commas and drops the empty fragments a doubled comma leaves", () => {
    expect(unwrap(parseGithubLabelArgs({ rest: ["--repo", "o/r", "--number", "7", "--add", " a ,, b,"] })).add).toEqual(
      ["a", "b"],
    );
  });

  it("rejects an --add that is nothing but separators", () => {
    expect(unwrapErr(parseGithubLabelArgs({ rest: ["--repo", "o/r", "--number", "7", "--add", " , "] }))).toEqual([
      "--add needs at least one label name",
    ]);
  });
});

describe("labelDoorRequest", () => {
  it("addresses the exact issue as the door artifact and marks the write external", () => {
    expect(
      labelDoorRequest({
        args: {
          add: ["e2e-local"],
          dryRun: false,
          home: undefined,
          json: false,
          number: 7,
          owner: "o",
          repo: "r",
        },
        home: "/tmp/home",
      }),
    ).toEqual({
      action: { kind: "verb", noun: "github", verb: "label" },
      artifact: { id: "o/r#7" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
    });
  });
});
