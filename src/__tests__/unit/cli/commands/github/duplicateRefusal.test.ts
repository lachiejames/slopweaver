/* The duplicate create refusal, and the update command it prints only for a number the update verb accepts. */
import { describe, expect, it } from "vitest";

import { duplicateRefusalLines } from "../../../../../cli/commands/github/duplicateRefusal.js";

const LOCUS = "acme/widget#main...fix";

describe("duplicateRefusalLines", () => {
  it("names the field-edit update for the pull request it cites", () => {
    expect(duplicateRefusalLines({ existing: 12, locus: LOCUS, repo: "acme/widget" })).toStrictEqual([
      "refused: acme/widget#main...fix is already reserved by #12. A second pull request for the same branches would be a duplicate, not a retry.",
      "To bring #12 up to date instead, put only the fields to change in edit.json and run:",
      "  slopweaver github pr update --repo acme/widget --number 12 --edit - < edit.json",
      "  A new walkthrough rides the same call as inline JSON: --self-review '<json>'.",
    ]);
  });

  it("prints no command for a recorded number that is not a whole number", () => {
    expect(duplicateRefusalLines({ existing: 1.5, locus: LOCUS, repo: "acme/widget" })).toStrictEqual([
      "refused: acme/widget#main...fix is already reserved by #1.5. A second pull request for the same branches would be a duplicate, not a retry.",
    ]);
  });
});
