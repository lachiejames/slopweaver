/**
 * The fleet's one-word state and headline: healthy, recovering, degraded or down, the plain reason when no
 * refusal names one, the refusal headline when one does, and the phrase a running attempt shows.
 */
import { describe, expect, it } from "vitest";

import { fleetHealthVerdict, recoveryPhase } from "../../../fleet/healthVerdict.js";
import { type FleetAttemptFold, type FleetSeatPhase } from "../../../fleet/journal.js";
import type { FleetRefusal } from "../../../fleet/refusals.js";
import type { FleetSeat } from "../../../fleet/types.js";

const ACCOUNTS = { emailFor: () => undefined };

/** A seat of one colour. */
function seat(over: Partial<FleetSeat> = {}): FleetSeat {
  return {
    colour: "green",
    detail: "up",
    flashing: false,
    priority: "p1",
    role: "worker",
    rowTitle: "A row",
    seatId: "s-1",
    ...over,
  };
}

/** An attempt fold with the given chair state, console and seat phases. */
function attempt(over: Partial<FleetAttemptFold> = {}): FleetAttemptFold {
  return {
    attemptId: "att",
    chair: { kind: "not-asked" },
    console: undefined,
    episodeId: "ep",
    finished: undefined,
    pid: 1,
    pidStart: undefined,
    seats: new Map(),
    startedAtIso: "2026-10-04T05:00:00.000Z",
    ...over,
  };
}

/** The verdict's inputs for a quiet fleet, overridden per case. */
function verdictOf({
  over,
}: {
  over: Partial<Parameters<typeof fleetHealthVerdict>[0]>;
}): ReturnType<typeof fleetHealthVerdict> {
  return fleetHealthVerdict({
    accounts: ACCOUNTS,
    attempt: undefined,
    attemptRunning: false,
    cmux: { kind: "answering" },
    consoleState: "serving",
    heldSeatIds: new Set(),
    seats: [seat()],
    ...over,
  });
}

/** A seat phase carrying one refusal. */
function refusedPhase({ refusal }: { refusal: FleetRefusal }): FleetSeatPhase {
  return { phase: "refused", refusal, role: "worker", sessionId: undefined, workspaceRef: "workspace:2" };
}

describe("fleetHealthVerdict", () => {
  it("calls an all-green fleet healthy, with the running headline and nothing unmapped", () => {
    const verdict = verdictOf({ over: {} });
    expect(verdict.state).toBe("healthy");
    expect(verdict.reason.code).toBe("HEALTHY");
    expect(verdict.reason.headline).toBe("The fleet is running.");
    expect(verdict.unmapped).toEqual([]);
  });

  it("never lets an empty red slot make the fleet down", () => {
    const verdict = verdictOf({ over: { seats: [seat(), seat({ colour: "red", role: "empty", seatId: "slot-2" })] } });
    expect(verdict.state).toBe("healthy");
  });

  it("calls a red seat with no attempt running down, and counts it in the headline", () => {
    const verdict = verdictOf({ over: { seats: [seat({ colour: "red" })] } });
    expect(verdict.state).toBe("down");
    expect(verdict.reason.code).toBe("FLEET_DOWN");
    expect(verdict.reason.headline).toBe("1 seat is down.");
  });

  it("pluralises the headline for several down seats", () => {
    const verdict = verdictOf({
      over: { seats: [seat({ colour: "red", seatId: "a" }), seat({ colour: "red", seatId: "b" })] },
    });
    expect(verdict.reason.headline).toBe("2 seats are down.");
  });

  it("calls a down console with every seat green down, with the console headline", () => {
    const verdict = verdictOf({ over: { consoleState: "down" } });
    expect(verdict.state).toBe("down");
    expect(verdict.reason.code).toBe("CONSOLE_DOWN");
  });

  it("never calls a fleet healthy on a console it could not measure", () => {
    const verdict = verdictOf({ over: { consoleState: "unmeasured" } });
    expect(verdict.state).toBe("down");
    expect(verdict.reason.code).toBe("CONSOLE_DOWN");
    expect(verdict.reason.headline).toBe("The console could not be checked.");
  });

  it("calls the fleet degraded when the only red seats are held crash loops", () => {
    const verdict = verdictOf({ over: { heldSeatIds: new Set(["s-1"]), seats: [seat({ colour: "red" })] } });
    expect(verdict.state).toBe("degraded");
    expect(verdict.reason.code).toBe("DEGRADED");
  });

  it("keeps the fleet down when a held seat sits beside another red one", () => {
    const verdict = verdictOf({
      over: {
        heldSeatIds: new Set(["held"]),
        seats: [seat({ colour: "red", seatId: "held" }), seat({ colour: "red", seatId: "dead" })],
      },
    });
    expect(verdict.state).toBe("down");
  });

  it("calls a running attempt recovering even over a red seat", () => {
    const verdict = verdictOf({ over: { attemptRunning: true, seats: [seat({ colour: "red" })] } });
    expect(verdict.state).toBe("recovering");
    expect(verdict.reason.code).toBe("RECOVERING");
  });

  it("calls a yellow seat with nothing red recovering, as settling", () => {
    const verdict = verdictOf({ over: { seats: [seat({ colour: "yellow" })] } });
    expect(verdict.state).toBe("recovering");
    expect(verdict.reason.code).toBe("SETTLING");
  });

  it("headlines the newest attempt's own refusal in place of the plain reason", () => {
    const refusal: FleetRefusal = { code: "CRASH_LOOP", message: "relaunched 3 times", workspaceRef: "workspace:2" };
    const verdict = verdictOf({
      over: {
        attempt: attempt({ seats: new Map([["workspace:2", refusedPhase({ refusal })]]) }),
        seats: [seat({ colour: "red" })],
      },
    });
    expect(verdict.reason.code).toBe("CRASH_LOOP");
    expect(verdict.reason.raw).toBe("relaunched 3 times");
    expect(verdict.unmapped).toEqual([]);
  });

  it("reads the attempt's finish refusal too, and lists an unknown code raw with its original code", () => {
    const refusal: FleetRefusal = { code: "UNKNOWN", message: "a newer thing", originalCode: "NEW_CODE" };
    const verdict = verdictOf({
      over: {
        attempt: attempt({ finished: { outcome: "failed", refusal } }),
        seats: [seat({ colour: "red" })],
      },
    });
    expect(verdict.reason.code).toBe("UNKNOWN");
    expect(verdict.unmapped).toEqual(["NEW_CODE: a newer thing"]);
  });

  it("lists an unknown refusal with no original code as its bare message", () => {
    const refusal: FleetRefusal = { code: "UNKNOWN", message: "bare text" };
    const verdict = verdictOf({
      over: { attempt: attempt({ finished: { outcome: "failed", refusal } }), seats: [seat({ colour: "red" })] },
    });
    expect(verdict.unmapped).toEqual(["bare text"]);
  });

  it("ignores a healthy fleet's stale refusals", () => {
    const refusal: FleetRefusal = { code: "CRASH_LOOP", message: "old" };
    const verdict = verdictOf({ over: { attempt: attempt({ finished: { outcome: "healthy", refusal } }) } });
    expect(verdict.reason.code).toBe("HEALTHY");
  });

  it("calls a fleet whose cmux is being restarted recovering, over every red seat", () => {
    const verdict = verdictOf({
      over: { cmux: { kind: "restarting", sinceIso: "2026-10-10T23:45:30.000Z" }, seats: [seat({ colour: "red" })] },
    });
    expect(verdict.state).toBe("recovering");
    expect(verdict.reason.code).toBe("CMUX_RESTARTING");
    expect(verdict.reason.headline).toBe("cmux stopped answering, so the fleet is restarting it (since 23:45Z).");
  });

  it("calls a hung cmux within its bound recovering, naming when it stopped", () => {
    const verdict = verdictOf({
      over: { cmux: { held: false, kind: "unresponsive", sinceIso: "2026-10-10T18:52:00.000Z" } },
    });
    expect(verdict.state).toBe("recovering");
    expect(verdict.reason.code).toBe("CMUX_UNRESPONSIVE");
    expect(verdict.reason.headline).toBe("cmux stopped answering at 18:52Z.");
  });

  it("calls a hung cmux whose restarts are held down", () => {
    const verdict = verdictOf({
      over: { cmux: { held: true, kind: "unresponsive", sinceIso: "2026-10-10T18:52:00.000Z" } },
    });
    expect(verdict.state).toBe("down");
    expect(verdict.reason.code).toBe("CMUX_HUNG_HELD");
  });

  it("calls a hang that came back after a restart degraded, naming how soon — never healthy, as 07:03Z read", () => {
    const recurring = { afterRestartIso: "2026-10-11T06:37:38.000Z", intervalMs: 18 * 60_000 + 53_000 };
    const verdict = verdictOf({
      over: { cmux: { held: false, kind: "unresponsive", recurring, sinceIso: "2026-10-11T06:56:31.000Z" } },
    });
    expect([verdict.state, verdict.reason.code, verdict.reason.headline]).toEqual([
      "degraded",
      "CMUX_RECURRING",
      "cmux hung again 19 minutes after the fleet restarted it at 06:37Z.",
    ]);
  });

  it("keeps a recurring hang's restart degraded while it runs", () => {
    const recurring = { afterRestartIso: "2026-10-11T06:37:38.000Z", intervalMs: 60_000 };
    const verdict = verdictOf({
      over: { cmux: { kind: "restarting", recurring, sinceIso: "2026-10-11T07:14:32.000Z" } },
    });
    expect([verdict.state, verdict.reason.headline]).toEqual([
      "degraded",
      "cmux hung again 1 minute after the fleet restarted it at 06:37Z.",
    ]);
  });

  it("lets a held recurring hang read down, never degraded", () => {
    const recurring = { afterRestartIso: "2026-10-11T07:14:38.000Z", intervalMs: 11 * 60_000 };
    const verdict = verdictOf({
      over: { cmux: { held: true, kind: "unresponsive", recurring, sinceIso: "2026-10-11T07:26:00.000Z" } },
    });
    expect([verdict.state, verdict.reason.code]).toEqual(["down", "CMUX_HUNG_HELD"]);
  });

  it("floors an otherwise healthy fleet at degraded for the hour after a loop's restart", () => {
    const recurring = { afterRestartIso: "2026-10-11T06:37:38.000Z", intervalMs: 18 * 60_000 };
    const verdict = verdictOf({ over: { cmux: { kind: "answering", recurring } } });
    expect([verdict.state, verdict.reason.code, verdict.reason.detail]).toEqual([
      "degraded",
      "CMUX_RECURRING",
      "It answers again. If it hangs once more within the hour, restarts are held and the supervisor investigates why.",
    ]);
  });

  it("never lets that floor mask a fleet that is down", () => {
    const recurring = { afterRestartIso: "2026-10-11T06:37:38.000Z", intervalMs: 18 * 60_000 };
    const verdict = verdictOf({ over: { cmux: { kind: "answering", recurring }, seats: [seat({ colour: "red" })] } });
    expect(verdict.state).toBe("down");
  });

  it("lets an unmeasured cmux leave the seats to decide", () => {
    const verdict = verdictOf({ over: { cmux: { kind: "unmeasured" } } });
    expect(verdict.state).toBe("healthy");
  });
});

describe("recoveryPhase", () => {
  it("says it is bringing the console back before the console has an outcome", () => {
    expect(recoveryPhase({ attempt: attempt() })).toBe("bringing the console back");
  });

  it("says it is bringing the supervisor back once the console is serving", () => {
    const phase = recoveryPhase({ attempt: attempt({ console: { detail: "up", state: "serving" } }) });
    expect(phase).toBe("bringing the supervisor back");
  });

  it("says it is waiting on the supervisor while the chair is awaited", () => {
    const phase = recoveryPhase({
      attempt: attempt({ chair: { chairSessionId: "c", chairWorkspaceId: "w", kind: "awaiting" } }),
    });
    expect(phase).toBe("waiting for the supervisor to say it is caught up");
  });

  it("says it is resuming the other seats once the chair reoriented", () => {
    const phase = recoveryPhase({
      attempt: attempt({ chair: { atIso: "2026-10-04T05:01:00.000Z", chairSessionId: "c", kind: "reoriented" } }),
    });
    expect(phase).toBe("resuming the other seats by priority");
  });
});
