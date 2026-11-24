/* The whole administrator-merge command a refusal hint prints, rendered from what its caller holds. */
import { describe, expect, it } from "vitest";

import { adminMergeCommand } from "../../../../outbound/github/adminMergeCommand.js";

describe("adminMergeCommand", () => {
  it("renders every flag the verb requires, from held values", () => {
    expect(adminMergeCommand({ base: "main", head: "feature", number: 9, repo: "acme/widget" })).toBe(
      "slopweaver github merge --repo acme/widget --base origin/main --head feature --description - " +
        "--admin --number 9 < body.md",
    );
  });

  it("carries a placeholder through untouched where the caller holds no value", () => {
    expect(adminMergeCommand({ base: "<base>", head: "<branch>", number: 32, repo: "owner/name" })).toBe(
      "slopweaver github merge --repo owner/name --base origin/<base> --head <branch> --description - " +
        "--admin --number 32 < body.md",
    );
  });

  it("prints a head carrying a shell character verbatim, unquoted, which is the stated residue", () => {
    expect(adminMergeCommand({ base: "main", head: "fix;x", number: 9, repo: "acme/widget" })).toBe(
      "slopweaver github merge --repo acme/widget --base origin/main --head fix;x --description - " +
        "--admin --number 9 < body.md",
    );
  });
});
