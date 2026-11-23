/**
 * The `plans set-usage-limit` verb, driven through the real run function over the shared recording seams.
 */
import { describe, expect, it } from "vitest";

import { plansUsage } from "../../../../../cli/commands/plans/plansUsage.js";
import { runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { fresh, recordingDeps } from "./plansRunFixtures.js";

describe("plans set-usage-limit", () => {
  it("builds a set-usage-limit mutation from the percent and allowance the command line gave", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--percent", "30", "--allowance", "weekly-window"],
      verb: "set-usage-limit",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      {
        alias: "plan-one",
        allowance: { kind: "weekly-window" },
        kind: "set-usage-limit",
        provider: "claude",
        usageLimitPercent: 30,
      },
    ]);
    expect(recording.out[0]).toBe(
      "plans: set the usage limit for claude/plan-one to 30% of its weekly-window allowance — 1 destination(s) now registered",
    );
  });

  it("records a monthly-spend limit on a Codex row as asked", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--plan", "codex-two", "--percent", "50", "--allowance", "monthly-spend"],
      verb: "set-usage-limit",
    });
    expect(recording.mutations).toStrictEqual([
      {
        alias: "codex-two",
        allowance: { kind: "monthly-spend" },
        kind: "set-usage-limit",
        provider: "codex",
        usageLimitPercent: 50,
      },
    ]);
  });

  it("refuses set-usage-limit with no percent or allowance, naming each, and writes nothing", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one"],
      verb: "set-usage-limit",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.mutations).toStrictEqual([]);
    expect(recording.diagnostics).toStrictEqual([
      "--percent is required",
      "--allowance is required",
      plansUsage({ verb: "set-usage-limit" }),
    ]);
  });

  it("prints --from as a flag that takes a value", () => {
    expect(plansUsage({ verb: "set-usage-limit" })).toBe(
      "usage: slopweaver plans set-usage-limit [--allowance <value>] [--from <value>] [--home <value>] [--json] " +
        "[--percent <value>] [--plan <value>] [--provider <value>]",
    );
  });

  it.each(["0", "25", "110", "30.5", "fifty"])(
    "refuses a --percent of %s, which no drop-down offers",
    async (percent) => {
      const recording = fresh();
      const code = await runPlansVerb({
        deps: recordingDeps({ recording }),
        rest: ["--provider", "claude", "--plan", "plan-one", "--percent", percent, "--allowance", "weekly-window"],
        verb: "set-usage-limit",
      });
      expect(code).toBe(EXIT_USAGE);
      expect(recording.mutations).toStrictEqual([]);
      expect(recording.diagnostics[0]).toBe("--percent must be one of 10, 20, 30, 40, 50, 60, 70, 80, 90, 100");
    },
  );

  it("carries --from onto the mutation as the limit the row must still hold", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: [
        "--provider",
        "codex",
        "--plan",
        "codex-two",
        "--percent",
        "40",
        "--allowance",
        "weekly-window",
        "--from",
        "30",
      ],
      verb: "set-usage-limit",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      {
        alias: "codex-two",
        allowance: { kind: "weekly-window" },
        fromUsageLimitPercent: 30,
        kind: "set-usage-limit",
        provider: "codex",
        usageLimitPercent: 40,
      },
    ]);
  });

  it("refuses a --from no drop-down offers, and writes nothing", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: [
        "--provider",
        "claude",
        "--plan",
        "plan-one",
        "--percent",
        "40",
        "--allowance",
        "weekly-window",
        "--from",
        "35",
      ],
      verb: "set-usage-limit",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.mutations).toStrictEqual([]);
    expect(recording.diagnostics[0]).toBe("--from must be one of 10, 20, 30, 40, 50, 60, 70, 80, 90, 100");
  });

  it("refuses an allowance kind the register does not record", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--percent", "30", "--allowance", "daily"],
      verb: "set-usage-limit",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics[0]).toBe("--allowance must be one of weekly-window, monthly-spend");
  });
});
