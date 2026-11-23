/*
 * The `turn answer` refusals decidable before any effect: absent required flags, an unknown flag, and the argv
 * offset the router hands a verb, proven both ways.
 */
import { describe, expect, it } from "vitest";

import { parseTurnArgs, runTurnAnswer } from "../../../../../../cli/commands/turn/run.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";

describe("turn answer refusals", () => {
  it("refuses with a usage code when the required flags are absent, before any effect", async () => {
    expect(await runTurnAnswer(["node", "slopweaver", "turn", "answer"])).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag rather than ignoring it", async () => {
    expect(await runTurnAnswer(["node", "slopweaver", "turn", "answer", "--not-a-flag", "x"])).toBe(EXIT_USAGE);
  });

  /**
   * The argv OFFSET, through the real shape the router hands a verb.
   *
   * This is the one defect in this file that a hand-made tail cannot catch, and it was live: the first cut
   * sliced from 3, which left the verb token `answer` in the flag tail, and the whole suite stayed green
   * because every other test here calls the pure parser.
   */
  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "turn", "answer", "--brief", "b.json", "--answer", "a.json"];
    const parsed = parseTurnArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("would reject the verb token if the offset were wrong, which is what makes the test above falsifiable", () => {
    const argv = ["node", "slopweaver", "turn", "answer", "--brief", "b.json"];
    const parsed = parseTurnArgs({ rest: argv.slice(3) });

    expect(parsed.isOk()).toBe(false);
    expect(parsed.isOk() ? [] : parsed.error).toEqual(["unexpected argument: answer"]);
  });
});
