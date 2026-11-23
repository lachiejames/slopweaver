import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { clockWarnToAppend, witnessWarnToAppend } from "../../../../live/turn/budgetWarn.js";
import type { ProgressLog, ProgressWarnEvent } from "../../../../live/turn/progressLog.js";
import { turnErrorLines } from "../../../../live/turn/turnErrors.js";

/** The replay fixture's generation: warn mark 05:44:52.099Z. */
const GEN = { leaseExpiresAt: "2026-09-12T06:24:48.249Z", tsIso: "2026-09-12T04:24:59.799Z" };

/** A log holding one warn the append decision is about to be asked about from an EARLIER instant. */
const holding = ({ warn }: { warn: ProgressWarnEvent }): ProgressLog => ({
  stages: [],
  timeline: [],
  warns: [warn],
  writes: [],
});

describe("an append decision sees every recorded warn, whatever instant it is judged at", () => {
  // The counterexample independent review built: a note at 06:00, then a sweep judged at 05:50.
  const lateWitness: ProgressWarnEvent = unwrap(
    witnessWarnToAppend({
      dispatched: GEN,
      expectedDispatchedIso: GEN.tsIso,
      log: { stages: [], timeline: [], warns: [], writes: [] },
      note: "round 2 carried round 1's claims",
      nowIso: "2026-09-12T06:00:00.000Z",
    }),
  );

  it("owes no clock warn over a witness note dated after the sweep's clock", () => {
    expect(
      clockWarnToAppend({ dispatched: GEN, log: holding({ warn: lateWitness }), nowIso: "2026-09-12T05:50:00.000Z" }),
    ).toBeUndefined();
  });

  it("owes no second clock warn over one dated after the sweep's clock", () => {
    const lateClock = clockWarnToAppend({
      dispatched: GEN,
      log: { stages: [], timeline: [], warns: [], writes: [] },
      nowIso: "2026-09-12T06:10:00.000Z",
    })!;
    expect(
      clockWarnToAppend({ dispatched: GEN, log: holding({ warn: lateClock }), nowIso: "2026-09-12T05:45:00.000Z" }),
    ).toBeUndefined();
  });

  it("refuses a second witness note judged at an earlier instant than the first", () => {
    const second = witnessWarnToAppend({
      dispatched: GEN,
      expectedDispatchedIso: GEN.tsIso,
      log: holding({ warn: lateWitness }),
      note: "again",
      nowIso: "2026-09-12T04:00:00.000Z",
    });
    expect(turnErrorLines({ error: second._unsafeUnwrapErr() })).toEqual([
      "this dispatch already carries a witness note — one note is the witness's whole output",
    ]);
  });
});
