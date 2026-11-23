/*
 * `runDripSequence`'s pacing: every send goes through the injected pacer, and a skipped message is never paced.
 */
import { describe, expect, it } from "vitest";
import { runDripSequence } from "../../../../../../cli/commands/slack/dripRun.js";
import { deps, freshHome, plan, recorder, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("runDripSequence — pacing", () => {
  it("routes EVERY send through the injected pacer, never around it", async () => {
    const home = freshHome();
    const paced: number[] = [];
    const base = deps({ api: recorder().api, home });

    await runDripSequence({
      deps: {
        ...base,
        pace: async (task) => {
          paced.push(paced.length);
          return task();
        },
      },
      plan: plan({ texts: ["one", "two", "three"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(paced).toEqual([0, 1, 2]);
  });

  it("does not pace a message it SKIPS — a resume of a finished drip costs no wall-clock", async () => {
    const home = freshHome();
    const sequence = plan({ texts: ["one", "two"] });
    await runDripSequence({
      deps: deps({ api: recorder().api, home }),
      plan: sequence,
      resend: { landed: false, unconfirmed: false },
    });

    let pacedCount = 0;
    const base = deps({ api: recorder().api, home });
    await runDripSequence({
      deps: {
        ...base,
        pace: async (task) => {
          pacedCount += 1;
          return task();
        },
      },
      plan: sequence,
      resend: { landed: false, unconfirmed: false },
    });

    expect(pacedCount).toBe(0);
  });
});
