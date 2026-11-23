/**
 * The chair's hand-off cadence as `supervisor tick close` judges it: the gauge and the chair reads it was handed, and
 * whether it prints the hand-off in place of the re-arm prompt. The chair reads are `chairOn` in `harness.ts`, and the
 * gauges are the captures in `gauges.ts`.
 */
import { describe, expect, it } from "vitest";

import type { SupervisorTickDeps } from "../../../../../../cli/commands/supervisor/tickDeps.js";
import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { SupervisorTickRow } from "../../../../../../supervisor/tickTypes.js";
import { READ_CHAIR } from "../tickFixtures.js";
import { GAUGE_AT_THE_WALL, GAUGE_ON_ITS_OWN_ROUTE } from "./gauges.js";
import { chairOn, dir, fake, seatAndOpen, useWorkdir } from "./harness.js";

useWorkdir();

describe("the chair's hand-off cadence, as the close judges it (plan-one ran its Fable week to the wall)", () => {
  it("prints the hand-off IN PLACE of the re-arm prompt for a chair at 97% of its Fable week, and still records", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const run = fake({ cadenceReads: chairOn({ alias: "plan-one" }), evidence: READ_CHAIR });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.appended.map((row) => row.tickId)).toEqual(["handoff-9292-tick-1"]);
    expect(run.diagnostics).toContain(
      "supervisor tick close: HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
    );
    expect(run.diagnostics).toContain(
      "supervisor tick close:   - plan-one is at 97% of its seven-day Fable week — at or past 75%, so leave it before the wall",
    );
    expect(run.out).toHaveLength(1);
    expect(run.out[0]!.split("\n")[0]).toBe(
      "HAND OFF NOW — do NOT re-arm the sweep from this chair. Its own measurements say seat a successor now:",
    );
    expect(run.out[0]).toContain("`slopweaver cmux spawn fresh-supervisor-handoff-9293 --driver claude --model fable`");
    expect(run.out[0]).toContain("`role: supervisor`");
    expect(run.out[0]).not.toContain("sweep-contract.md");
  });

  it("prints the sweep prompt unchanged for a chair on the plan routing picks, byte for byte the uncadenced one", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const staying = fake({ cadenceReads: chairOn({ alias: "plan-three" }), evidence: READ_CHAIR });
    expect(await runSupervisorTick({ deps: staying.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    // The finished close re-run with no chair read owes no stage and prints the prompt again: the control.
    const unjudged = fake({ ledger: staying.appended });
    expect(await runSupervisorTick({ deps: unjudged.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);

    expect(staying.out).toStrictEqual(unjudged.out);
    expect(staying.out[0]).toContain("/checkout/skills/supervisor/reference/sweep-contract.md");
    expect(staying.diagnostics.some((line) => line.includes("HAND OFF"))).toBe(false);
    expect(unjudged.diagnostics).toContain(
      "supervisor tick close: chair cadence: not judged — an earlier close recorded this tick",
    );
    expect(unjudged.appended).toHaveLength(1);
  });

  it("prints the sweep prompt for a chair at 76% of its week whose plan routing still picks for Fable", async () => {
    await seatAndOpen({ gauge: GAUGE_ON_ITS_OWN_ROUTE });
    const run = fake({ cadenceReads: chairOn({ alias: "plan-five" }), evidence: READ_CHAIR });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.diagnostics.some((line) => line.includes("HAND OFF"))).toBe(false);
    expect(run.diagnostics).toContain(
      "supervisor tick close: chair cadence: plan-five is at 76% of its seven-day week, but the chair's successor routes to plan-five too, so a successor would land on the same plan — not a reason to hand off until routing moves off it",
    );
    expect(run.out[0]).toContain("/checkout/skills/supervisor/reference/sweep-contract.md");
  });

  it("never hands off on a re-run of a recorded close, whose fresh chair reads the tick never measured", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const staying = fake({ cadenceReads: chairOn({ alias: "plan-three" }), evidence: READ_CHAIR });
    expect(await runSupervisorTick({ deps: staying.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    // The chair has since moved onto the plan at the wall, so a re-judged re-run would hand off.
    const rerun = fake({
      cadenceReads: chairOn({ alias: "plan-one" }),
      evidence: READ_CHAIR,
      ledger: staying.appended,
    });
    expect(await runSupervisorTick({ deps: rerun.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);

    expect(rerun.out).toStrictEqual(staying.out);
    expect(rerun.diagnostics.some((line) => line.includes("HAND OFF"))).toBe(false);
    expect(rerun.diagnostics).toContain(
      "supervisor tick close: chair cadence: not judged — an earlier close recorded this tick",
    );
    expect(staying.appended.map((row) => row.tickId)).toEqual(["handoff-9292-tick-1"]);
  });

  it("names an unmeasured gauge and hands off on nothing it could not measure", async () => {
    await seatAndOpen();
    const run = fake({ cadenceReads: chairOn({ alias: "plan-one" }), evidence: READ_CHAIR });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(
      run.diagnostics.some((line) =>
        line.startsWith("supervisor tick close: chair cadence: the plan gauge is UNMEASURED this tick"),
      ),
    ).toBe(true);
    expect(run.out[0]).toContain("/checkout/skills/supervisor/reference/sweep-contract.md");
  });

  it("names a chair read that threw, keeps the recorded tick and its exit, and prints the sweep prompt", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const throwing: SupervisorTickDeps["cadenceReads"] = {
      ...chairOn({ alias: "plan-one" }),
      readChairPlans: () => {
        throw new Error("lsof timed out");
      },
    };
    const run = fake({ cadenceReads: throwing, evidence: READ_CHAIR });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.appended).toHaveLength(1);
    expect(run.diagnostics).toContain(
      "supervisor tick close: chair cadence: not judged — a chair read threw: lsof timed out",
    );
    expect(run.out[0]).toContain("/checkout/skills/supervisor/reference/sweep-contract.md");
  });

  it("survives a chair read throwing a value that cannot even be printed", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const unprintable = new Proxy(
      {},
      {
        getPrototypeOf: (): object | null => {
          throw new Error("trap");
        },
      },
    );
    const throwing: SupervisorTickDeps["cadenceReads"] = {
      ...chairOn({ alias: "plan-one" }),
      readChairPlans: () => {
        throw unprintable;
      },
    };
    const run = fake({ cadenceReads: throwing, evidence: READ_CHAIR });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.appended).toHaveLength(1);
    expect(run.diagnostics).toContain(
      "supervisor tick close: chair cadence: not judged — a chair read threw: a thrown value that could not be printed",
    );
    expect(run.out[0]).toContain("/checkout/skills/supervisor/reference/sweep-contract.md");
  });

  it("judges a stranded close only on the resume that finishes it, printing the hand-off once", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const ledger: SupervisorTickRow[] = [];
    const stranded = fake({
      cadenceReads: chairOn({ alias: "plan-one" }),
      evidence: READ_CHAIR,
      ledger,
      publishFails: true,
    });
    expect(await runSupervisorTick({ deps: stranded.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(stranded.out).toStrictEqual([]);
    expect(stranded.diagnostics.some((line) => line.includes("HAND OFF"))).toBe(false);

    const resumed = fake({ cadenceReads: chairOn({ alias: "plan-one" }), evidence: READ_CHAIR, ledger });
    expect(await runSupervisorTick({ deps: resumed.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(resumed.out).toHaveLength(1);
    expect(resumed.out[0]!.startsWith("HAND OFF NOW")).toBe(true);
    expect(ledger.map((row) => row.tickId)).toEqual(["handoff-9292-tick-1"]);
  });
});
