/*
 * `profile words --help`: both forms, the two reading caveats and every exit code, read off the usage leaf alone.
 */
import { describe, expect, it } from "vitest";

import { PROFILE_WORDS_USAGE } from "../../../../../../cli/commands/profile/wordsUsage.js";

describe("profile words --help", () => {
  it("states both forms, the two reading caveats and every exit code", () => {
    expect(PROFILE_WORDS_USAGE.split("\n").slice(0, 3)).toEqual([
      "usage: slopweaver profile words [--phrase <words>] [--since <iso|7d|12h>] [--until <iso>] [--how spoken|written]",
      "                                [--limit <n>] [--full] [--json] [--home <dir>] [--now <iso>]",
      "       slopweaver profile words <anchor> [--json] [--home <dir>]",
    ]);
    expect(PROFILE_WORDS_USAGE).toContain("a turn they dictated into the supervisor reads written");
    expect(PROFILE_WORDS_USAGE).toContain("Exits 0 with a match, 3 with none and nothing\nunread, 1");
  });
});
