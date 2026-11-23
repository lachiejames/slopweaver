/**
 * The supervisor's colour on the sessions page: green only on its own reorientation or a sweep it closed since it
 * took the pin, yellow while it is still waited on, red once it has gone quiet past the pass's wait.
 */
import { describe, expect, it } from "vitest";

import type { FleetLiveSession } from "../../../../fleet/evidence.js";
import type { FleetJournalEvent } from "../../../../fleet/journal.js";
import { judgeFleet } from "../../../../fleet/judge.js";
import { CHAIR, evidence, journalled, session } from "./harness.js";

describe("judgeFleet", () => {
  it("never turns the chair green for running alone: no reorientation since its process started is yellow", () => {
    const document = judgeFleet({
      evidence: evidence({ reorientations: new Map([[CHAIR, "2026-10-04T04:59:59.000Z"]]) }),
    });
    const chair = document.seats.find((seat) => seat.role === "supervisor")!;
    expect(chair.colour).toBe("yellow");
    expect(chair.flashing).toBe(false);
    expect(document.state).toBe("recovering");
  });

  it("calls the fleet down once a chair has gone past the pass's wait without saying it is caught up", () => {
    const document = judgeFleet({
      evidence: evidence({ nowIso: "2026-10-04T05:10:01.000Z", reorientations: new Map() }),
    });
    const chair = document.seats.find((seat) => seat.role === "supervisor")!;
    expect(chair.colour).toBe("red");
    expect(chair.detail).toBe(
      "There seems to be a problem: it is running, but it has not said it is caught up or closed a sweep in the 10 minutes since it started.",
    );
    expect(chair.lastSignal).toBeUndefined();
    expect(chair.signalExpectedSinceIso).toBe("2026-10-04T05:00:00.000Z");
    expect(document.state).toBe("down");
    expect(document.reason.code).toBe("FLEET_DOWN");
  });

  it("names the chair's reorientation as its last sign of working when it turns green on one", () => {
    const chair = judgeFleet({ evidence: evidence() }).seats.find((seat) => seat.role === "supervisor")!;
    expect(chair.colour).toBe("green");
    expect(chair.detail).toBe("Caught up and supervising.");
    expect(chair.lastSignal).toEqual({ atIso: "2026-10-04T05:01:00.000Z", kind: "reoriented" });
  });

  describe("a chair seated by handoff, long after its process booted", () => {
    const booted = Date.parse("2026-10-09T19:53:41.000Z");
    const handoff = {
      chairPinnedAtIso: "2026-10-09T23:27:54.000Z",
      chairWorkspaceRef: "workspace:1011",
      reorientations: new Map<string, string>(),
      sessions: [session({ row: undefined, sessionId: CHAIR, startedAtMs: booted, workspaceRef: "workspace:1011" })],
    };

    it("never dates an old reorientation inside a process whose start the registry did not record", () => {
      const chair = judgeFleet({
        evidence: evidence({
          ...handoff,
          nowIso: "2026-10-10T02:28:00.000Z",
          reorientations: new Map([[CHAIR, "2026-10-09T23:00:00.000Z"]]),
          sessions: [session({ row: undefined, sessionId: CHAIR, startedAtMs: 0, workspaceRef: "workspace:1011" })],
        }),
      }).seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("red");
    });

    it("counts no sign at all when neither its start nor its pin can be read", () => {
      const chair = judgeFleet({
        evidence: evidence({
          ...handoff,
          chairPinnedAtIso: "not-an-instant",
          chairSweep: {
            finalisedIso: "2026-10-10T02:16:04.366Z",
            kind: "swept",
            startedIso: "2026-10-10T02:05:00.000Z",
            tickId: "handoff-9318-tick-5",
          },
          nowIso: "2026-10-10T02:28:00.000Z",
          reorientations: new Map([[CHAIR, "2026-10-01T00:00:00.000Z"]]),
          sessions: [session({ row: undefined, sessionId: CHAIR, startedAtMs: 0, workspaceRef: "workspace:1011" })],
        }),
      }).seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("red");
    });

    it("dates no sweep against its process start when its pin cannot be read", () => {
      const chair = judgeFleet({
        evidence: evidence({
          ...handoff,
          chairPinnedAtIso: "not-an-instant",
          chairSweep: {
            finalisedIso: "2026-10-10T02:16:04.366Z",
            kind: "swept",
            startedIso: "2026-10-10T02:05:00.000Z",
            tickId: "handoff-9318-tick-5",
          },
          nowIso: "2026-10-10T02:28:00.000Z",
        }),
      }).seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("red");
    });

    it("still counts its own reorientation when its pin cannot be read, because that is dated from its start", () => {
      const chair = judgeFleet({
        evidence: evidence({
          ...handoff,
          chairPinnedAtIso: "not-an-instant",
          nowIso: "2026-10-10T02:28:00.000Z",
          reorientations: new Map([[CHAIR, "2026-10-09T20:00:00.000Z"]]),
        }),
      }).seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("green");
    });

    it("judges the twin in the pinned workspace, never an older process of the same session", () => {
      const twins = [
        session({ row: undefined, sessionId: CHAIR, startedAtMs: booted, workspaceRef: "workspace:old" }),
        session({
          row: undefined,
          sessionId: CHAIR,
          startedAtMs: Date.parse("2026-10-10T02:00:00.000Z"),
          workspaceRef: "workspace:1011",
        }),
      ];
      const judged = ({ order }: { order: readonly FleetLiveSession[] }): string =>
        judgeFleet({
          evidence: evidence({
            ...handoff,
            nowIso: "2026-10-10T02:28:00.000Z",
            reorientations: new Map([[CHAIR, "2026-10-10T01:00:00.000Z"]]),
            sessions: order,
          }),
        }).seats.find((seat) => seat.role === "supervisor")!.colour;
      expect(judged({ order: twins })).toBe("red");
      expect(judged({ order: twins.toReversed() })).toBe("red");
    });

    it("reads green on a sweep it closed after taking the pin, with no reorientation at all", () => {
      const document = judgeFleet({
        evidence: evidence({
          ...handoff,
          chairSweep: {
            finalisedIso: "2026-10-10T02:16:04.366Z",
            kind: "swept",
            startedIso: "2026-10-10T02:05:00.000Z",
            tickId: "handoff-9318-tick-5",
          },
          nowIso: "2026-10-10T02:28:00.000Z",
        }),
      });
      const chair = document.seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("green");
      expect(chair.detail).toBe("Supervising: it has closed a sweep since it became the supervisor.");
      expect(chair.lastSignal).toEqual({ atIso: "2026-10-10T02:16:04.366Z", kind: "swept" });
      expect(chair.signalExpectedSinceIso).toBe("2026-10-09T23:27:54.000Z");
      expect(document.state).toBe("healthy");
    });

    it("never counts a sweep that started before it took the pin, even one that finished after", () => {
      const chair = judgeFleet({
        evidence: evidence({
          ...handoff,
          chairSweep: {
            finalisedIso: "2026-10-09T23:31:00.000Z",
            kind: "swept",
            startedIso: "2026-10-09T23:20:00.000Z",
            tickId: "handoff-9317-tick-10",
          },
          nowIso: "2026-10-09T23:40:00.000Z",
        }),
      }).seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("red");
      expect(chair.lastSignal).toEqual({ atIso: "2026-10-09T23:31:00.000Z", kind: "swept" });
    });

    it("never counts a sweep closed before it took the pin, even one stamped as starting after", () => {
      const chair = judgeFleet({
        evidence: evidence({
          ...handoff,
          chairSweep: {
            finalisedIso: "2026-10-09T23:20:00.000Z",
            kind: "swept",
            startedIso: "2026-10-09T23:31:00.000Z",
            tickId: "handoff-9317-tick-11",
          },
          nowIso: "2026-10-09T23:40:00.000Z",
        }),
      }).seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("red");
    });

    it("never counts a sweep from before it took the pin, but still names it as the last sign seen", () => {
      const document = judgeFleet({
        evidence: evidence({
          ...handoff,
          chairSweep: {
            finalisedIso: "2026-10-09T23:05:55.128Z",
            kind: "swept",
            startedIso: "2026-10-09T22:55:00.000Z",
            tickId: "handoff-9317-tick-9",
          },
          nowIso: "2026-10-09T23:40:00.000Z",
        }),
      });
      const chair = document.seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("red");
      expect(chair.detail).toBe(
        "There seems to be a problem: it is running, but it has not said it is caught up or closed a sweep in the 10 minutes since it became the supervisor.",
      );
      expect(chair.lastSignal).toEqual({ atIso: "2026-10-09T23:05:55.128Z", kind: "swept" });
      expect(document.state).toBe("down");
    });

    it("starts the wait when it took the pin, not when its process booted, so it is yellow at first", () => {
      const document = judgeFleet({ evidence: evidence({ ...handoff, nowIso: "2026-10-09T23:30:00.000Z" }) });
      const chair = document.seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("yellow");
      expect(chair.detail).toBe(
        "Running, but it has not yet said it is caught up or closed a sweep since it became the supervisor.",
      );
      expect(document.state).toBe("recovering");
    });

    it("says its sweep record could not be read rather than calling the chair quiet", () => {
      const document = judgeFleet({
        evidence: evidence({
          ...handoff,
          chairSweep: { kind: "unreadable", why: "a tick ledger line in the tail is not JSON" },
          nowIso: "2026-10-10T02:28:00.000Z",
        }),
      });
      const chair = document.seats.find((seat) => seat.role === "supervisor")!;
      expect(chair.colour).toBe("red");
      expect(chair.detail).toBe(
        "There seems to be a problem: it is running, but it has not said it is caught up or closed a sweep in the 10 minutes since it became the supervisor. Its sweep record could not be read, so a sweep it closed may not have been seen.",
      );
    });
  });

  it("calls the fleet down for a quiet chair whose record claims a start later than now, which would never age out", () => {
    const future = session({ row: undefined, sessionId: CHAIR, startedAtMs: 8_640_000_000_000_000 });
    const document = judgeFleet({ evidence: evidence({ reorientations: new Map(), sessions: [future, session()] }) });
    expect(document.seats.find((seat) => seat.role === "supervisor")!.colour).toBe("red");
    expect(document.state).toBe("down");
  });

  it("keeps a quiet chair yellow past that wait while an attempt is still running", () => {
    const document = judgeFleet({
      evidence: evidence({ attemptRunning: true, nowIso: "2026-10-04T05:30:00.000Z", reorientations: new Map() }),
    });
    const chair = document.seats.find((seat) => seat.role === "supervisor")!;
    expect(chair.colour).toBe("yellow");
    expect(document.state).toBe("recovering");
  });

  it("never turns a reoriented chair green on a boot not bound to its process", () => {
    const document = judgeFleet({
      evidence: evidence({
        sessions: [session({ boot: { kind: "unresolved", why: "PRODUCER TEXT" }, row: undefined, sessionId: CHAIR })],
      }),
    });
    const chair = document.seats.find((seat) => seat.role === "supervisor")!;
    expect(chair.colour).toBe("yellow");
    expect(chair.detail).toBe("Running, but which plan it is on could not be read.");
    expect(document.capacity.online).toBe(0);
  });

  it("flashes the chair while a running attempt waits on its reorientation", () => {
    const base = { attemptId: "att", schemaVersion: 1 as const };
    const events: FleetJournalEvent[] = [
      { ...base, atIso: "2026-10-04T05:00:01.000Z", episodeId: "ep", kind: "attempt-started", pid: 42 },
      {
        ...base,
        atIso: "2026-10-04T05:00:02.000Z",
        chairSessionId: CHAIR,
        chairWorkspaceId: "ws-1",
        kind: "chair-awaiting-reorientation",
      },
    ];
    const document = judgeFleet({ evidence: evidence({ ...journalled({ events }), attemptRunning: true }) });
    const chair = document.seats.find((seat) => seat.role === "supervisor")!;
    expect(chair.colour).toBe("yellow");
    expect(chair.flashing).toBe(true);
    expect(document.recovery).toEqual({
      attemptId: "att",
      phase: "waiting for the supervisor to say it is caught up",
      startedAtIso: "2026-10-04T05:00:01.000Z",
    });
  });
});
