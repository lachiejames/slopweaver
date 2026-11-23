/**
 * The press budget of `runGithubLanding --press`: the supervisor tick kills the whole read at 300s and a killed
 * read reports nothing, so a backlog stops STARTING presses at the pass budget and
 * names the rows the next pass takes — checked before a row's pre-press reads and again at its press — while a dry
 * run, which presses nothing, never reads the clock.
 */

import { describe, expect, it } from "vitest";
import { performPresses } from "../../../../../../cli/commands/github/landingPress.js";
import { runGithubLanding } from "../../../../../../cli/commands/github/landingRun.js";
import { PRESS_PASS_BUDGET_MS } from "../../../../../../cli/commands/github/landingUsage.js";
import { dependencyBotActors } from "../../../../../../organisation/dependencyBots.js";
import { landingRowFake } from "../../../../../landingRowFake.js";
import { onePage, pr } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubLanding --press budget", () => {
  it("stops starting presses once the pass budget is spent and says the next pass presses the rest", async () => {
    const numbers = [16378, 16379, 16380, 16381];
    const h = harness({ pages: onePage({ prs: numbers.map((number) => pr({ number })) }) });
    // Each press costs 100s on this clock, so the first two start inside 150s and the third finds it spent.
    const now = (): Date => new Date(Date.parse("2026-09-09T12:30:00.000Z") + h.pressed.length * 100_000);
    await runGithubLanding({
      deps: { ...h.deps, now },
      rest: ["--repo", "acme/widgets", "--author", "@me", "--press"],
    });
    expect(h.pressed).toEqual([16378, 16379].map((n) => `--pr ${String(n)} --repo acme/widgets`));
    expect(h.out.filter((line) => line.includes("press starts on the rows before it"))).toEqual(
      [16380, 16381].map(
        (n) =>
          `failed: acme/widgets#${String(n)} — not pressed: this pass spent its 150s of press starts on the rows ` +
          "before it — the next pass presses it",
      ),
    );
  });

  it("always starts the first press, since the budget runs from it, however far the clock moved before it", async () => {
    const h = harness({ pages: onePage({ prs: [pr({ number: 16378 }), pr({ number: 16379 })] }) });
    const calls = { count: 0 };
    // Every read of the clock is a whole budget after the last, so any check before the first press finds it spent.
    const now = (): Date => {
      calls.count += 1;
      return new Date(Date.parse("2026-09-09T12:30:00.000Z") + calls.count * 150_000);
    };
    await runGithubLanding({
      deps: { ...h.deps, now },
      rest: ["--repo", "acme/widgets", "--author", "@me", "--press"],
    });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(h.out.filter((line) => line.includes("press starts on the rows before it"))).toEqual([
      "failed: acme/widgets#16379 — not pressed: this pass spent its 150s of press starts on the rows before it " +
        "— the next pass presses it",
    ]);
  });

  it("reports a row not pressed when its own pre-press reads cross the budget — a review counterexample", async () => {
    const h = harness({ pages: onePage({ prs: [pr({ number: 16378 }), pr({ number: 16379 })] }) });
    const clock = { ms: 0 };
    // The loop's check before the second row finds nothing spent; its own head re-read is where the budget runs out.
    const headsNow: typeof h.deps.headsNow = (seam) => {
      const read = h.deps.headsNow(seam);
      return (query) => {
        clock.ms = h.pressed.length * PRESS_PASS_BUDGET_MS;
        return read(query);
      };
    };
    await runGithubLanding({
      deps: { ...h.deps, headsNow, now: () => new Date(Date.parse("2026-09-09T12:30:00.000Z") + clock.ms) },
      rest: ["--repo", "acme/widgets", "--author", "@me", "--press"],
    });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(h.out.filter((line) => line.includes("press starts on the rows before it"))).toEqual([
      "failed: acme/widgets#16379 — not pressed: this pass spent its 150s of press starts on the rows before it " +
        "— the next pass presses it",
    ]);
  });

  it("lets a dry run report every row past the pass budget, since it presses none", async () => {
    const numbers = [16378, 16379, 16380];
    const h = harness({ pages: onePage({ prs: numbers.map((number) => pr({ number })) }) });
    const calls = { count: 0 };
    // Every read of the clock is 100s after the last, so the budget is long spent by the third row.
    const now = (): Date => {
      calls.count += 1;
      return new Date(Date.parse("2026-09-09T12:30:00.000Z") + calls.count * 100_000);
    };
    await runGithubLanding({
      deps: { ...h.deps, now },
      rest: ["--repo", "acme/widgets", "--author", "@me", "--press", "--dry-run"],
    });
    expect(h.pressed).toEqual([]);
    expect(h.out.filter((line) => line.startsWith("would-press: ")).map((line) => line.split(" ")[1])).toEqual(
      numbers.map((n) => `acme/widgets#${String(n)}`),
    );
    expect(h.out.filter((line) => line.includes("press starts on the rows before it"))).toEqual([]);
  });

  it("never reads the clock for a dry run's press, so a dry run's outcomes cannot hinge on it", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const outcomes = await performPresses({
      args: { authoredByOwner: true, dryRun: true, json: false },
      bots: dependencyBotActors({ dependencyBots: [] }),
      deps: {
        ...h.deps,
        now: () => {
          throw new Error("the press read the clock on a dry run");
        },
      },
      home: undefined,
      rows: [landingRowFake()],
    });
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["would-press"]);
  });
});
