/**
 * Every command-line refusal `parsePlansArgs` returns carries its own typed code, so a caller branches on the
 * kind of mistake rather than on a sentence.
 */
import { describe, expect, it } from "vitest";

import { PlansArgsErrors } from "../../../../../cli/commands/plans/argsErrors.js";
import { parsePlansArgs } from "../../../../../cli/commands/plans/core.js";
import { plansUsage } from "../../../../../cli/commands/plans/plansUsage.js";
import { runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { fresh, recordingDeps } from "./plansRunFixtures.js";

/**
 * The refusal code one argv draws.
 *
 * @param rest the argv tail after `plans <verb>`
 * @param verb which verb was dispatched
 * @returns the code of the error the parse returned
 */
function codeFor({ rest, verb }: { rest: readonly string[]; verb: string }): string {
  return unwrapErr(parsePlansArgs({ rest, verb })).code;
}

describe("parsePlansArgs refusals", () => {
  it("names each mistake by its own code", () => {
    expect([
      codeFor({ rest: [], verb: "delete" }),
      codeFor({ rest: ["--bogus"], verb: "list" }),
      codeFor({ rest: ["--provider", "claude"], verb: "pin" }),
      codeFor({ rest: ["--provider", "gemini", "--plan", "p"], verb: "pin" }),
      codeFor({ rest: ["--provider", "claude", "--plan", "p", "--store-dir", "rel/dir"], verb: "add" }),
      codeFor({ rest: ["--provider", "claude", "--plan", "p", "--on", "tomorrow"], verb: "lapse" }),
      codeFor({ rest: ["--provider", "claude", "--plan", "p"], verb: "set-usage-limit" }),
      codeFor({ rest: ["--provider", "claude", "--plan", "p", "--store-dir", "/s/p", "--percent", "33"], verb: "add" }),
    ]).toStrictEqual([
      "PLANS_VERB_UNKNOWN",
      "PLANS_FLAGS_UNPARSED",
      "PLANS_FLAG_MISSING",
      "PLANS_FLAG_CHOICE_UNKNOWN",
      "PLANS_STORE_DIR_RELATIVE",
      "PLANS_LAPSE_INSTANT_MALFORMED",
      "PLANS_USAGE_LIMIT_UNREADABLE",
      "PLANS_FLAG_CHOICE_UNKNOWN",
    ]);
  });

  it("carries the offending value on the error, not only in its sentence", () => {
    const refused = parsePlansArgs({
      rest: ["--provider", "claude", "--plan", "p", "--on", "tomorrow"],
      verb: "lapse",
    });
    expect(unwrapErr(refused)).toStrictEqual({
      code: "PLANS_LAPSE_INSTANT_MALFORMED",
      given: "tomorrow",
      message: "--on must be an ISO-8601 instant, such as 2026-11-17T00:00:00Z; got tomorrow",
    });
  });

  it("prints each flag-parser problem on its own diagnostic line above the usage, as it did before the union", async () => {
    const rest = ["--bogus", "--wat"];
    const problems = unwrapErr(parsePlansArgs({ rest, verb: "list" }));
    const recording = fresh();
    const code = await runPlansVerb({ deps: recordingDeps({ recording }), rest, verb: "list" });

    expect(code).toBe(EXIT_USAGE);
    expect(problems.code).toBe("PLANS_FLAGS_UNPARSED");
    expect(recording.diagnostics).toStrictEqual([
      "unknown flag: --bogus",
      "unknown flag: --wat",
      plansUsage({ verb: "list" }),
    ]);
  });

  it("joins every flag-parser problem into one displayable sentence, keeping the list", () => {
    expect(PlansArgsErrors.flagsUnparsed({ problems: ["unknown flag --a", "unknown flag --b"] })).toStrictEqual({
      code: "PLANS_FLAGS_UNPARSED",
      message: "unknown flag --a; unknown flag --b",
      problems: ["unknown flag --a", "unknown flag --b"],
    });
  });
});
