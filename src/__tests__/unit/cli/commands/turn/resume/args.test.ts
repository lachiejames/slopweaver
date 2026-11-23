/**
 * `slopweaver turn resume` — its argv parser, and the usage refusals it answers before reading any state.
 */
import { describe, expect, it } from "vitest";

import { parseTurnResumeArgs, runTurnResume } from "../../../../../../cli/commands/turn/resume.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { unwrapErr } from "../../../../../../lib/result.js";

describe("parseTurnResumeArgs", () => {
  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "turn", "resume", "--dispatch", "x"];
    const parsed = parseTurnResumeArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseTurnResumeArgs({ rest: ["--not-a-flag", "x"] }))).toEqual([
      "unknown flag: --not-a-flag",
      "unexpected argument: x",
    ]);
  });
});

describe("turn resume — usage refusals", () => {
  it("refuses with a usage code when --dispatch is absent", () => {
    expect(runTurnResume(["node", "slopweaver", "turn", "resume"])).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag with a usage code", () => {
    expect(runTurnResume(["node", "slopweaver", "turn", "resume", "--not-a-flag", "x"])).toBe(EXIT_USAGE);
  });
});
