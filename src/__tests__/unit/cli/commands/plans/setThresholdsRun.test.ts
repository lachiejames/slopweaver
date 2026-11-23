/**
 * The `plans set-thresholds` verb, driven through the real run function over the shared recording seams: what the
 * command line becomes, and every mistake it refuses before the register is touched.
 */
import { describe, expect, it } from "vitest";

import { plansUsage } from "../../../../../cli/commands/plans/plansUsage.js";
import { runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { fresh, recordingDeps } from "./plansRunFixtures.js";

describe("plans set-thresholds", () => {
  it("sets coupled Claude fields in ONE mutation, so no invalid intermediate register is published", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--route-at-percent", "94", "--acceptance-at-percent", "89"],
      verb: "set-thresholds",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      {
        change: { provider: "claude", reset: [], set: { acceptanceAtPercent: 89, routeAtPercent: 94 } },
        kind: "set-thresholds",
      },
    ]);
    expect(recording.out[0]).toBe(
      "plans: set acceptance-at-percent to 89, route-at-percent to 94 for claude — 1 destination(s) now registered",
    );
  });

  it("resets every repeated --reset field together, and names them", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--reset", "route-at-percent", "--reset", "acceptance-at-percent"],
      verb: "set-thresholds",
    });
    expect(recording.mutations).toStrictEqual([
      {
        change: { provider: "claude", reset: ["routeAtPercent", "acceptanceAtPercent"], set: {} },
        kind: "set-thresholds",
      },
    ]);
    expect(recording.out[0]).toBe(
      "plans: reset route-at-percent, acceptance-at-percent to the default for claude — 1 destination(s) now registered",
    );
  });

  it("reads Codex's own fields under --provider codex", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--pause-at-percent", "97", "--reset", "alert-at-percent"],
      verb: "set-thresholds",
    });
    expect(recording.mutations).toStrictEqual([
      {
        change: { provider: "codex", reset: ["alertAtPercent"], set: { pauseAtPercent: 97 } },
        kind: "set-thresholds",
      },
    ]);
  });

  it("refuses a field of the other provider, naming it, and writes nothing", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--route-at-percent", "94"],
      verb: "set-thresholds",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.mutations).toStrictEqual([]);
    expect(recording.diagnostics).toStrictEqual([
      "--route-at-percent is not a codex threshold",
      plansUsage({ verb: "set-thresholds" }),
    ]);
  });

  it("names every problem at once: text that is no whole number, a field both set and reset, an unknown reset", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: [
        "--provider",
        "claude",
        "--alert-at-percent",
        "seventy",
        "--route-at-percent",
        "94",
        "--reset",
        "route-at-percent",
        "--reset",
        "pause-at-percent",
      ],
      verb: "set-thresholds",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics).toStrictEqual([
      "--alert-at-percent must be a whole number; got seventy",
      "--route-at-percent is both set and reset",
      "--reset pause-at-percent names no claude threshold — one of alert-at-percent, acceptance-at-percent, " +
        "route-at-percent, spend-out-at-percent, spend-out-before-reset-minutes, balanced-spread-percent, " +
        "drifting-spread-percent",
      plansUsage({ verb: "set-thresholds" }),
    ]);
  });

  it("refuses an invocation that changes nothing", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude"],
      verb: "set-thresholds",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics[0]).toBe("set at least one threshold, or --reset one");
  });

  it("refuses a value flag given twice, since only --reset repeats", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--route-at-percent", "94", "--route-at-percent", "93"],
      verb: "set-thresholds",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.mutations).toStrictEqual([]);
    expect(recording.diagnostics[0]).toContain("--route-at-percent was given 2 times — pass it once");
  });
});
