import { describe, expect, it } from "vitest";

import { GITHUB_CHECKS_FLAG_NAMES } from "../../../../../cli/commands/github/checksCore.js";
import { readTheLogClause } from "../../../../../cli/commands/github/ciFindings.js";

describe("readTheLogClause", () => {
  it("names the pull request it was built for", () => {
    expect(readTheLogClause({ number: 1004 })).toBe(
      "  Read what the failed checks printed with `slopweaver github checks --number 1004 --log` " +
        "(or `github run-log <run-id>`) — never by running the lane in this seat.",
    );
  });

  it("names a flag `github checks` really accepts, so the remedy cannot drift from the verb", () => {
    expect(GITHUB_CHECKS_FLAG_NAMES).toContain("--log");
    expect(readTheLogClause({ number: 1 })).toContain("--log");
  });

  it("points at the run-id verb as the second way in, never at a local lane", () => {
    expect(readTheLogClause({ number: 7 })).toContain("github run-log <run-id>");
    expect(readTheLogClause({ number: 7 })).toContain("never by running the lane in this seat");
  });
});
