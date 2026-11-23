/**
 * How long a row takes and how often it works: what is timed from where, what never counts as a duration, and the
 * exact sentences the page and the terminal both print.
 */
import { describe, expect, it } from "vitest";

import type { FiringView } from "../../../automations/card.js";
import {
  durationWords,
  finishedBySettleOf,
  firingRunMsOf,
  glanceWords,
  type RunTiming,
  reliabilityWords,
  runDurationOf,
  runReliabilityOf,
  runTimingOf,
  spanWords,
  underWayFiringOf,
} from "../../../automations/runStats.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";

const definition = (over: Partial<RecipeDefinition> = {}): RecipeDefinition => ({
  cadence: "0 */4 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "resync",
  onMissed: "backfill",
  params: { argv: ["recipe", "resync", "--source", "gmail"] },
  recipeId: "resync-corpus-gmail",
  schemaVersion: 1,
  ...over,
});

/** A firing taken at the hour, its run started a minute later, settled `runSeconds` after that. */
function firing({
  hour,
  runSeconds,
  outcome = "succeeded",
}: {
  hour: number;
  runSeconds: number;
  outcome?: FiringView["outcome"];
}): FiringView {
  const slot = Date.UTC(2026, 9, 9, hour);
  const runStart = slot + 60_000;
  return {
    attempt: 1,
    detail: null,
    exitCode: null,
    outcome,
    reason: null,
    runStartedAtIso: new Date(runStart).toISOString(),
    settledAtIso: outcome === "open" ? null : new Date(runStart + runSeconds * 1000).toISOString(),
    slotIso: new Date(slot).toISOString(),
    startedAtIso: new Date(slot).toISOString(),
  };
}

const NOW = "2026-10-09T23:00:00.000Z";

describe("runTimingOf", () => {
  it("times a resync from its run start, a command from its take, and leaves a hand-off untimed", () => {
    expect([
      runTimingOf({ definition: definition() }),
      runTimingOf({ definition: definition({ kind: "verb-run" }) }),
      runTimingOf({ definition: definition({ kind: "inbox-triage" }) }),
    ]).toEqual(["run-started", "taken", "hand-off"]);
  });
});

describe("runDurationOf", () => {
  it("takes the median of the newest successes and names the newest finished run as the last", () => {
    const firings = [
      firing({ hour: 4, outcome: "failed", runSeconds: 1 }),
      firing({ hour: 3, runSeconds: 300 }),
      firing({ hour: 2, runSeconds: 120 }),
      firing({ hour: 1, runSeconds: 200 }),
    ];

    const duration = runDurationOf({ firings, run: undefined, timing: "run-started" });

    expect(duration).toStrictEqual({
      last: { ms: 1000, outcome: "failed", settledAtIso: "2026-10-09T04:01:01.000Z" },
      lastIsNewest: true,
      runningSinceIso: null,
      timing: "run-started",
      typicalMs: 200_000,
      typicalSamples: 3,
      waitingSinceIso: null,
    });
    expect(durationWords({ duration, historyComplete: true, nowIso: NOW })).toBe(
      "Usually takes 3m; the last run failed after 1s.",
    );
  });

  it("names the run that finished last as the last, not the newest slot, when two settle out of order", () => {
    // Slot 10:00 fails at 10:05; the older 09:00 slot works, settling at 10:10.
    const firings = [firing({ hour: 10, outcome: "failed", runSeconds: 240 }), firing({ hour: 9, runSeconds: 4140 })];

    expect([
      finishedBySettleOf({ firings, run: undefined }).map((each) => each.slotIso),
      runDurationOf({ firings, run: undefined, timing: "run-started" }).last,
    ]).toEqual([
      ["2026-10-09T09:00:00.000Z", "2026-10-09T10:00:00.000Z"],
      { ms: 4_140_000, outcome: "succeeded", settledAtIso: "2026-10-09T10:10:00.000Z" },
    ]);
  });

  it("breaks a same-millisecond settle tie by the run stamp, whose exit code names the run written last", () => {
    // Slot 10:00 fails at 10:02:00; the older 09:00 slot succeeds with exit 3 in that same millisecond and stamps last.
    const failed = firing({ hour: 10, outcome: "failed", runSeconds: 60 });
    const worked = { ...firing({ hour: 9, runSeconds: 3660 }), exitCode: 3 };
    const firings = [failed, worked];
    const run = { exitCode: 3, lastRunAtIso: "2026-10-09T10:02:00.000Z", watermarkIso: "2026-10-09T10:00:00.000Z" };

    expect([
      finishedBySettleOf({ firings, run }).map((each) => each.slotIso),
      finishedBySettleOf({ firings, run: { ...run, exitCode: 1 } }).map((each) => each.slotIso),
      runDurationOf({ firings, run, timing: "run-started" }).last,
    ]).toEqual([
      ["2026-10-09T09:00:00.000Z", "2026-10-09T10:00:00.000Z"],
      ["2026-10-09T10:00:00.000Z", "2026-10-09T09:00:00.000Z"],
      { ms: 3_660_000, outcome: "succeeded", settledAtIso: "2026-10-09T10:02:00.000Z" },
    ]);
  });

  it("never reads a dead or deferred firing's settle as a duration, and calls the run it times the last TIMED one", () => {
    const firings = [
      firing({ hour: 3, outcome: "dead", runSeconds: 9000 }),
      firing({ hour: 2, outcome: "deferred", runSeconds: 5 }),
      firing({ hour: 1, runSeconds: 600 }),
    ];

    const duration = runDurationOf({ firings, run: undefined, timing: "run-started" });

    expect(duration.last).toStrictEqual({
      ms: 600_000,
      outcome: "succeeded",
      settledAtIso: "2026-10-09T01:11:00.000Z",
    });
    expect(duration.typicalMs).toBe(null);
    expect(duration.lastIsNewest).toBe(false);
    expect(durationWords({ duration, historyComplete: true, nowIso: NOW })).toBe(
      "The last timed run took 10m; too few runs have worked to say what is usual.",
    );
    expect(
      glanceWords({
        duration,
        reliability: runReliabilityOf({ firings, historyComplete: true, run: undefined, skipped: null }),
      }),
    ).toBe("last timed 10m · 1/2 worked");
  });

  it("times a command from when it was taken, the seat wait included because there is none", () => {
    const duration = runDurationOf({ firings: [firing({ hour: 1, runSeconds: 30 })], run: undefined, timing: "taken" });

    expect(duration.last!.ms).toBe(90_000);
  });

  it("says a run under way, and a seated one still waiting for its session, with the time so far", () => {
    const running = runDurationOf({
      firings: [firing({ hour: 22, outcome: "open", runSeconds: 0 }), firing({ hour: 1, runSeconds: 60 })],
      run: undefined,
      timing: "run-started",
    });
    const waiting = runDurationOf({
      firings: [{ ...firing({ hour: 22, outcome: "open", runSeconds: 0 }), runStartedAtIso: null }],
      run: undefined,
      timing: "run-started",
    });

    expect(durationWords({ duration: running, historyComplete: true, nowIso: NOW })).toBe(
      "Running now, 59m so far. The last run took 60s; too few runs have worked to say what is usual.",
    );
    expect(durationWords({ duration: waiting, historyComplete: true, nowIso: NOW })).toBe(
      "Waiting 60m so far for its session to start. No run has finished yet to time.",
    );
  });

  it("never claims no run finished over a history that did not read whole: it says only what is under way, else nothing", () => {
    const waiting = runDurationOf({
      firings: [{ ...firing({ hour: 22, outcome: "open", runSeconds: 0 }), runStartedAtIso: null }],
      run: undefined,
      timing: "run-started",
    });
    const none = runDurationOf({ firings: [], run: undefined, timing: "run-started" });

    expect([
      durationWords({ duration: waiting, historyComplete: false, nowIso: NOW }),
      durationWords({ duration: none, historyComplete: false, nowIso: NOW }),
      glanceWords({
        duration: none,
        reliability: runReliabilityOf({ firings: [], historyComplete: false, run: undefined, skipped: null }),
      }),
    ]).toEqual(["Waiting 60m so far for its session to start.", "", ""]);
  });

  it("never reads an open firing behind a newer finished or abandoned run as under way, but does behind a deferral", () => {
    const stranded = firing({ hour: 1, outcome: "open", runSeconds: 0 });
    const behindRun = [firing({ hour: 3, runSeconds: 60 }), stranded];
    const behindDead = [firing({ hour: 3, outcome: "dead", runSeconds: 0 }), stranded];
    const behindDeferral = [firing({ hour: 3, outcome: "deferred", runSeconds: 0 }), stranded];

    expect([behindRun, behindDead, behindDeferral].map((firings) => underWayFiringOf({ firings }))).toEqual([
      null,
      null,
      stranded,
    ]);
    expect(
      durationWords({
        duration: runDurationOf({ firings: behindRun, run: undefined, timing: "run-started" }),
        historyComplete: true,
        nowIso: NOW,
      }),
    ).toBe("The last run took 60s; too few runs have worked to say what is usual.");
  });

  it("says a hand-off is not timed rather than printing the worklist read as its length", () => {
    const duration = runDurationOf({
      firings: [firing({ hour: 1, runSeconds: 2 })],
      run: undefined,
      timing: "hand-off",
    });

    expect(duration.last).toBe(null);
    expect(durationWords({ duration, historyComplete: true, nowIso: NOW })).toBe(
      "Not timed: it hands its work to a session, and that session's time is not recorded.",
    );
  });
});

describe("runReliabilityOf", () => {
  it("rates the newest ten finished firings, an abandoned one counted as not working, open and deferred left out", () => {
    const firings = [
      firing({ hour: 23, outcome: "open", runSeconds: 0 }),
      firing({ hour: 22, outcome: "deferred", runSeconds: 0 }),
      firing({ hour: 21, outcome: "dead", runSeconds: 0 }),
      firing({ hour: 20, outcome: "failed", runSeconds: 0 }),
      ...Array.from({ length: 12 }, (_, index) => firing({ hour: 19 - index, runSeconds: 10 })),
    ];

    const reliability = runReliabilityOf({
      firings,
      historyComplete: true,
      run: undefined,
      skipped: { bound: "exact", count: 100 },
    });

    expect(reliability).toStrictEqual({
      considered: 10,
      historyComplete: true,
      skipped: { bound: "exact", count: 100 },
      worked: 8,
    });
    expect(reliabilityWords({ reliability })).toBe(
      "Worked 8 of its last 10 runs. 100 scheduled times passed with no run.",
    );
  });

  it("says each edge plainly: none finished, one, all, none worked, and over a history that did not read whole never a zero", () => {
    const words = ({
      finished,
      historyComplete = true,
    }: {
      finished: FiringView[];
      historyComplete?: boolean;
    }): string =>
      reliabilityWords({
        reliability: runReliabilityOf({ firings: finished, historyComplete, run: undefined, skipped: null }),
      });
    const failed = firing({ hour: 2, outcome: "failed", runSeconds: 1 });

    expect([
      words({ finished: [] }),
      words({ finished: [firing({ hour: 1, runSeconds: 1 })] }),
      words({ finished: [firing({ hour: 2, runSeconds: 1 }), firing({ hour: 1, runSeconds: 1 })] }),
      words({ finished: [failed, firing({ hour: 1, outcome: "dead", runSeconds: 1 })] }),
      words({ finished: [failed], historyComplete: false }),
      words({ finished: [], historyComplete: false }),
    ]).toEqual([
      "No run has finished yet.",
      "Its one finished run worked.",
      "Worked every one of its last 2 runs.",
      "Failed every one of its last 2 runs.",
      "Its one finished run failed.",
      "",
    ]);
  });

  it("names a skipped count it could only bound from below as at least that many", () => {
    const reliability = runReliabilityOf({
      firings: [],
      historyComplete: true,
      run: undefined,
      skipped: { bound: "at-least", count: 3 },
    });

    expect(reliabilityWords({ reliability })).toBe(
      "No run has finished yet. At least 3 scheduled times passed with no run.",
    );
  });

  it("says one skipped time in the singular", () => {
    const reliability = runReliabilityOf({
      firings: [],
      historyComplete: true,
      run: undefined,
      skipped: { bound: "exact", count: 1 },
    });

    expect(reliabilityWords({ reliability })).toBe("No run has finished yet. 1 scheduled time passed with no run.");
  });
});

describe("glanceWords and firingRunMsOf", () => {
  it("folds both answers into a few words, falling back from usual to last to untimed", () => {
    const usual = [firing({ hour: 3, runSeconds: 240 }), firing({ hour: 2, runSeconds: 240 })];
    const glance = ({ firings, timing }: { firings: FiringView[]; timing: "run-started" | "hand-off" }): string =>
      glanceWords({
        duration: runDurationOf({ firings, run: undefined, timing }),
        reliability: runReliabilityOf({ firings, historyComplete: true, run: undefined, skipped: null }),
      });

    expect([
      glance({ firings: usual, timing: "run-started" }),
      glance({ firings: [firing({ hour: 1, outcome: "failed", runSeconds: 5 })], timing: "run-started" }),
      glance({ firings: [], timing: "run-started" }),
      glance({ firings: usual, timing: "hand-off" }),
    ]).toEqual([
      "usually 4m · 2/2 worked",
      "last 5s · 0/1 worked",
      "no timed run · no finished run",
      "not timed · 2/2 worked",
    ]);
  });

  it("gives a timeline bullet the same run time the answer uses, and none for what is not timed", () => {
    const open = firing({ hour: 22, outcome: "open", runSeconds: 0 });
    const unstarted = { ...open, runStartedAtIso: null };
    const runMs = ({
      of,
      timing = "run-started",
      underWay = open,
    }: {
      of: FiringView;
      timing?: RunTiming;
      underWay?: FiringView;
    }): number | null => firingRunMsOf({ firing: of, nowIso: NOW, timing, underWay });

    expect([
      runMs({ of: firing({ hour: 1, runSeconds: 30 }) }),
      runMs({ of: open }),
      runMs({ of: unstarted, underWay: unstarted }),
      runMs({ of: firing({ hour: 1, runSeconds: 30 }), timing: "hand-off" }),
      runMs({ of: firing({ hour: 1, outcome: "dead", runSeconds: 30 }), timing: "taken" }),
      firingRunMsOf({ firing: open, nowIso: NOW, timing: "run-started", underWay: null }),
    ]).toEqual([30_000, 3_540_000, null, null, null, null]);
  });
});

describe("spanWords", () => {
  it("rounds to the unit a person reads at a glance", () => {
    expect([spanWords({ ms: 45_000 }), spanWords({ ms: 12 * 60_000 }), spanWords({ ms: 3 * 3_600_000 })]).toEqual([
      "45s",
      "12m",
      "3h",
    ]);
  });
});
