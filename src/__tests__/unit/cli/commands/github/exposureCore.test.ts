import { describe, expect, it } from "vitest";

import { GithubExposureArgsErrors, parseGithubExposureArgs } from "../../../../../cli/commands/github/exposureCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubExposureArgs", () => {
  it("parses an inventory of one repository", () => {
    expect(unwrap(parseGithubExposureArgs({ argv: ["inventory", "--repo", "acme/widgets", "--json"] }))).toEqual({
      home: undefined,
      json: true,
      owner: "acme",
      repo: "widgets",
      subVerb: "inventory",
    });
  });

  it("parses a sweep with the same flags", () => {
    expect(
      unwrap(parseGithubExposureArgs({ argv: ["sweep", "--repo", "acme/widgets", "--home", "/tmp/sw-home"] })),
    ).toEqual({ home: "/tmp/sw-home", json: false, owner: "acme", repo: "widgets", subVerb: "sweep" });
  });

  it("refuses a missing sub-verb by name", () => {
    const refused = unwrapErr(parseGithubExposureArgs({ argv: ["--repo", "acme/widgets"] }));
    expect(refused).toEqual(GithubExposureArgsErrors.missingSubVerb({ got: "--repo" }));
    expect(refused.message).toBe('github exposure needs a sub-verb: inventory or sweep (got "--repo")');
  });

  it("refuses an inventory with no repository", () => {
    const refused = unwrapErr(parseGithubExposureArgs({ argv: ["inventory"] }));
    expect(refused.code).toBe("MISSING_REPO");
    expect(refused.message).toBe("--repo owner/name is required");
  });

  it("refuses a flag the verb does not take", () => {
    const refused = unwrapErr(parseGithubExposureArgs({ argv: ["inventory", "--repo", "acme/widgets", "--apply"] }));
    expect(refused.code).toBe("BAD_FLAGS");
    expect(refused.message).toContain("--apply");
  });
});
