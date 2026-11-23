import { describe, expect, it } from "vitest";

import { type Flights, forgetFlights, rideOrRun } from "../../lib/liveFlights";
import { LIVE_FLIGHTS } from "../../lib/liveFlightsServer";

/** A read that answers only when told to, so a test controls when a flight lands. */
function heldRead({ value }: { value: string }): {
  run: () => Promise<string>;
  land: () => void;
  started: () => number;
} {
  let starts = 0;
  let release: (answer: string) => void = () => undefined;
  return {
    land: () => {
      release(value);
    },
    run: () => {
      starts += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    },
    started: () => starts,
  };
}

describe("one child process per verb in flight", () => {
  it("rides the read already under way rather than starting a second", async () => {
    const flights: Flights<string> = new Map();
    const read = heldRead({ value: "hands@1" });
    const first = rideOrRun({ flights, fresh: false, key: "hands", run: read.run });
    const second = rideOrRun({ flights, fresh: false, key: "hands", run: read.run });
    read.land();
    expect(await second.answer).toBe("hands@1");
    expect(second.rode).toBe(true);
    expect(first.rode).toBe(false);
    expect(read.started()).toBe(1);
  });

  it("keeps nothing once a flight lands, so the next read starts its own", async () => {
    const flights: Flights<string> = new Map();
    const read = heldRead({ value: "hands@1" });
    const first = rideOrRun({ flights, fresh: false, key: "hands", run: read.run });
    read.land();
    await first.answer;
    expect(flights.size).toBe(0);
    rideOrRun({ flights, fresh: false, key: "hands", run: read.run });
    expect(read.started()).toBe(2);
  });

  it("never answers a press with a flight already under way, even one that left in the same millisecond", () => {
    const flights: Flights<string> = new Map();
    const read = heldRead({ value: "hands" });
    rideOrRun({ flights, fresh: false, key: "hands", run: read.run });
    const press = rideOrRun({ flights, fresh: true, key: "hands", run: read.run });
    expect(press.rode).toBe(false);
    expect(read.started()).toBe(2);
  });

  it("lets a later plain read ride the press's own flight, and an older landing never removes it", async () => {
    const flights: Flights<string> = new Map();
    const old = heldRead({ value: "before" });
    const pressed = heldRead({ value: "after" });
    rideOrRun({ flights, fresh: false, key: "hands", run: old.run });
    rideOrRun({ flights, fresh: true, key: "hands", run: pressed.run });
    old.land();
    await Promise.resolve();
    const later = rideOrRun({ flights, fresh: false, key: "hands", run: old.run });
    pressed.land();
    expect(await later.answer).toBe("after");
  });

  // A tab opened after the pressing tab closed rode a read that left before the act wrote.
  it("lets no later reader ride a flight under way when an act wrote, while its own riders still get its answer", async () => {
    const flights: Flights<string> = new Map();
    const before = heldRead({ value: "before" });
    const after = heldRead({ value: "after" });
    const rider = rideOrRun({ flights, fresh: false, key: "autonomy", run: before.run });
    forgetFlights({ flights });
    const later = rideOrRun({ flights, fresh: false, key: "autonomy", run: after.run });
    before.land();
    after.land();
    expect([later.rode, await later.answer, await rider.answer]).toEqual([false, "after", "before"]);
  });

  it("keeps different verbs apart", () => {
    const flights: Flights<string> = new Map();
    const read = heldRead({ value: "x" });
    rideOrRun({ flights, fresh: false, key: "hands", run: read.run });
    rideOrRun({ flights, fresh: false, key: "build", run: read.run });
    expect(read.started()).toBe(2);
  });
});

// The live and act routes are separate module graphs, so a module-local map let the act route clear
// one map while the live route rode another.
describe("the server's one set of flights", () => {
  it("is the process-global map every route and re-evaluation reads, never a module-local one", () => {
    const held = (globalThis as Record<symbol, unknown>)[Symbol.for("slopweaver.liveFlights")];
    expect(held).toBe(LIVE_FLIGHTS);
  });
});
