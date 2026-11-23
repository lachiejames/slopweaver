/**
 * The supervisor tick runs the global `turn dispatch --sweep` — how a turn dispatched from a host with no
 * same-session wake is reconciled. Held here so the reading cannot drop out of the tick unnoticed.
 */
import { describe, expect, it } from "vitest";

import { TURN_DISPATCH_SWEEP_READING } from "../../../../supervisor/digestTurnSweep.js";
import { tickReadingProducer, tickReadings } from "../../../../supervisor/scratch/tickCapture.js";

const READINGS = tickReadings({ loopSessionKey: "live-loop-a" });

describe("the tick's turn dispatch sweep reading", () => {
  it("runs the sweep as text, on the shared budget, retried once when it prints nothing", () => {
    const sweep = READINGS.find((reading) => reading.name === TURN_DISPATCH_SWEEP_READING)!;
    expect([
      sweep.argv,
      sweep.format,
      sweep.completedExits,
      sweep.timeoutMs,
      sweep.retryWhenEmpty,
      tickReadingProducer({ reading: sweep }),
    ]).toEqual([["turn", "dispatch", "--sweep"], "text", undefined, undefined, true, "turn dispatch"]);
  });

  it("runs right after the seat's own standing reading, before every other fleet reading", () => {
    const names = READINGS.map((reading) => reading.name);
    expect(names.indexOf(TURN_DISPATCH_SWEEP_READING)).toBe(names.indexOf("standing") + 1);
    expect(names.indexOf("recipe-due")).toBe(names.indexOf(TURN_DISPATCH_SWEEP_READING) + 1);
  });
});
