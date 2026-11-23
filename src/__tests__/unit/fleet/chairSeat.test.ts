/**
 * The supervisor's seat alone: which live process is the chair, and what it reads when it gave no sign of working.
 * The whole page's colours, the chair's among them, are the `judge/` tests.
 */
import { describe, expect, it } from "vitest";

import { CODEX_CHAIR_LIVE, chairSeat } from "../../../fleet/chairSeat.js";
import type { FleetEvidence, FleetLiveSession } from "../../../fleet/evidence.js";

const SEAT = "44444444-4444-4444-8444-444444444444";
const PIN = "2026-10-10T11:00:00.000Z";

/** One process of the chair's session in a workspace, started at the given instant (0: unknown). */
function chairProcessIn({
  workspaceRef,
  startedAtMs,
}: {
  workspaceRef: string;
  startedAtMs: number;
}): FleetLiveSession {
  return {
    boot: { alias: "plan-four", kind: "token" },
    cwd: "/wt/chair",
    row: undefined,
    sessionId: SEAT,
    startedAtMs,
    workspaceRef,
  };
}

/** The chair pinned at PIN in `workspace:pinned`, judged at noon, with no sweep and the given processes. */
function pinnedChair({
  reorientedIso,
  sessions,
}: {
  reorientedIso: string;
  sessions: readonly FleetLiveSession[];
}): FleetEvidence {
  return {
    accounts: { emailFor: () => undefined },
    attempt: undefined,
    attemptRunning: false,
    chairPinnedAtIso: PIN,
    chairSessionId: SEAT,
    chairSweep: { kind: "none" },
    chairWorkspaceRef: "workspace:pinned",
    cmux: { kind: "answering" },
    config: { capacity: 3, schemaVersion: 1 },
    console: { port: 4100, state: "serving" },
    keepAlive: { detail: "Watching.", live: true },
    loop: { detail: "Listening.", live: true },
    nowIso: "2026-10-10T12:00:00.000Z",
    reorientations: new Map([[SEAT, reorientedIso]]),
    sessions,
    signedOutStores: new Set(),
  };
}

describe("chairSeat", () => {
  it("reads red, saying so, when nothing records which session is the supervisor", () => {
    const seat = chairSeat({
      evidence: { ...pinnedChair({ reorientedIso: PIN, sessions: [] }), chairSessionId: undefined },
    });
    expect(seat.colour).toBe("red");
    expect(seat.detail).toBe("Nothing records which session is the supervisor.");
    expect(seat.live).toBeUndefined();
  });

  it("reads a Codex chair a Codex process holds as live and yellow, never dated against a Claude session sharing its id", () => {
    const shared = chairProcessIn({ startedAtMs: Date.parse(PIN), workspaceRef: "workspace:pinned" });
    const seat = chairSeat({
      evidence: {
        ...pinnedChair({ reorientedIso: PIN, sessions: [shared] }),
        chairCodex: {
          observation: { kind: "live", path: "/u/.codex/thread-writer-locks/x.lock", pid: 7 },
          threadId: SEAT,
        },
        chairSessionId: undefined,
      },
    });
    expect(seat.colour).toBe("yellow");
    expect(seat.detail).toBe(CODEX_CHAIR_LIVE);
    expect(CODEX_CHAIR_LIVE).toBe(
      "The supervisor runs on Codex and a Codex process holds its thread, so it is running; whether it is caught up is not read here, so it is not green.",
    );
    expect(seat.live).toBe(true);
    expect(seat.sessionId).toBeUndefined();
  });

  it("reads a Codex chair no process was seen holding as UNMEASURED and yellow, never red (Codex 4d plan)", () => {
    const seat = chairSeat({
      evidence: {
        ...pinnedChair({ reorientedIso: PIN, sessions: [] }),
        chairCodex: { observation: { kind: "not-observed", why: "lsof ended with exit 2" }, threadId: SEAT },
        chairSessionId: undefined,
      },
    });
    expect(seat.colour).toBe("yellow");
    expect(seat.detail).toBe("Codex chair liveness UNMEASURED — lsof ended with exit 2.");
    expect(seat.live).toBeUndefined();
  });

  it("reads yellow and unresolved, never judging a live Claude session, when the records name no host", () => {
    const live = chairProcessIn({ startedAtMs: Date.parse(PIN), workspaceRef: "workspace:pinned" });
    const seat = chairSeat({
      evidence: {
        ...pinnedChair({ reorientedIso: PIN, sessions: [live] }),
        chairSessionId: undefined,
        chairUnresolved: "1 line",
      },
    });
    expect(seat.colour).toBe("yellow");
    expect(seat.detail).toBe("Which session holds the chair could not be read: 1 line");
    expect(seat.live).toBeUndefined();
  });

  it("is not live when its session's process is not running", () => {
    const seat = chairSeat({ evidence: pinnedChair({ reorientedIso: PIN, sessions: [] }) });
    expect(seat.colour).toBe("red");
    expect(seat.detail).toBe("The supervisor is not running.");
    expect(seat.live).toBeUndefined();
  });

  it("is live whose plan could not be read, inside the wait and past it, since no wall was read", () => {
    const unread: FleetLiveSession = {
      ...chairProcessIn({ startedAtMs: Date.parse("2026-10-10T11:55:00.000Z"), workspaceRef: "workspace:pinned" }),
      boot: { kind: "unresolved", why: "the plan register could not be read" },
    };
    const fresh = chairSeat({ evidence: pinnedChair({ reorientedIso: PIN, sessions: [unread] }) });
    expect(fresh.colour).toBe("yellow");
    expect(fresh.live).toBe(true);
    const stale = chairSeat({
      evidence: pinnedChair({ reorientedIso: PIN, sessions: [{ ...unread, startedAtMs: Date.parse(PIN) }] }),
    });
    expect(stale.colour).toBe("red");
    expect(stale.live).toBe(true);
  });

  it("is not live on a login no plan names, though its process runs", () => {
    const walled: FleetLiveSession = {
      ...chairProcessIn({ startedAtMs: Date.parse(PIN), workspaceRef: "workspace:pinned" }),
      boot: { kind: "off-plan", why: "default login" },
    };
    const seat = chairSeat({ evidence: pinnedChair({ reorientedIso: PIN, sessions: [walled] }) });
    expect(seat.colour).toBe("red");
    expect(seat.detail).toBe("It came back on the default login, which no plan names — the wall a restart leaves.");
    expect(seat.live).toBeUndefined();
  });

  it("never judges a process outside the pinned workspace while two twins sit in it", () => {
    const seat = chairSeat({
      evidence: pinnedChair({
        reorientedIso: "2026-10-10T10:30:00.000Z",
        sessions: [
          chairProcessIn({ startedAtMs: 0, workspaceRef: "workspace:pinned" }),
          chairProcessIn({ startedAtMs: 0, workspaceRef: "workspace:pinned" }),
          chairProcessIn({ startedAtMs: Date.parse("2026-10-10T10:00:00.000Z"), workspaceRef: "workspace:other" }),
        ],
      }),
    });
    expect(seat.colour).toBe("red");
    expect(seat.signalExpectedSinceIso).toBe(PIN);
  });

  it("dates a twin of unknown start from the pin, never from an older twin's known start", () => {
    const twins = [
      chairProcessIn({ startedAtMs: Date.parse("2026-10-10T10:00:00.000Z"), workspaceRef: "workspace:pinned" }),
      chairProcessIn({ startedAtMs: 0, workspaceRef: "workspace:pinned" }),
    ];
    const colour = ({ sessions }: { sessions: readonly FleetLiveSession[] }): string =>
      chairSeat({ evidence: pinnedChair({ reorientedIso: "2026-10-10T10:30:00.000Z", sessions }) }).colour;
    expect(colour({ sessions: twins })).toBe("red");
    expect(colour({ sessions: twins.toReversed() })).toBe("red");
  });

  it("dates no sweep against a pin that is not an ISO instant, though Date.parse would read one", () => {
    const seat = chairSeat({
      evidence: {
        ...pinnedChair({
          reorientedIso: "2026-10-10T09:00:00.000Z",
          sessions: [
            chairProcessIn({ startedAtMs: Date.parse("2026-10-10T10:00:00.000Z"), workspaceRef: "workspace:pinned" }),
          ],
        }),
        chairPinnedAtIso: "0",
        chairSweep: {
          finalisedIso: "2026-10-10T11:00:00.000Z",
          kind: "swept",
          startedIso: "2026-10-10T10:30:00.000Z",
          tickId: "t-1",
        },
      },
    });
    expect(seat.colour).toBe("red");
  });

  it("never counts a reorientation stamped with an impossible date, which Date.parse rolls forward", () => {
    const seat = chairSeat({
      evidence: pinnedChair({
        // Date.parse rolls this forward into the next month, after the process started.
        reorientedIso: "2026-02-30T00:00:00.000Z",
        sessions: [
          chairProcessIn({ startedAtMs: Date.parse("2026-03-01T00:00:00.000Z"), workspaceRef: "workspace:pinned" }),
        ],
      }),
    });
    expect(seat.colour).toBe("red");
  });

  it("ranks a known start before the epoch as known, never as the unknown 0", () => {
    const twins = [
      chairProcessIn({ startedAtMs: Date.parse("2026-10-10T11:30:00.000Z"), workspaceRef: "workspace:pinned" }),
      chairProcessIn({ startedAtMs: -1000, workspaceRef: "workspace:pinned" }),
    ];
    const seat = chairSeat({
      evidence: {
        ...pinnedChair({ reorientedIso: "2026-10-10T11:15:00.000Z", sessions: twins }),
        nowIso: "2026-10-10T11:35:00.000Z",
      },
    });
    expect(seat.colour).toBe("yellow");
    expect(seat.signalExpectedSinceIso).toBe("2026-10-10T11:30:00.000Z");
  });

  it("dates an unknown start from a valid pin even at the epoch, which the unknown mark shares", () => {
    const epoch = "1970-01-01T00:00:00.000Z";
    const seat = chairSeat({
      evidence: {
        ...pinnedChair({
          reorientedIso: epoch,
          sessions: [chairProcessIn({ startedAtMs: 0, workspaceRef: "workspace:pinned" })],
        }),
        chairPinnedAtIso: epoch,
        nowIso: "1970-01-01T00:01:00.000Z",
      },
    });
    expect(seat.colour).toBe("green");
  });

  it("counts a reorientation from the pinned process's own start, not the pin, when that start is known", () => {
    const seat = chairSeat({
      evidence: pinnedChair({
        reorientedIso: "2026-10-10T10:30:00.000Z",
        sessions: [
          chairProcessIn({ startedAtMs: Date.parse("2026-10-10T10:00:00.000Z"), workspaceRef: "workspace:pinned" }),
        ],
      }),
    });
    expect(seat.colour).toBe("green");
    expect(seat.detail).toBe("Caught up and supervising.");
  });

  it("says what has not arrived, past the wait, when the chair gave no sign since it took the seat", () => {
    const seat = chairSeat({
      evidence: pinnedChair({
        reorientedIso: "2026-10-10T09:00:00.000Z",
        sessions: [
          chairProcessIn({ startedAtMs: Date.parse("2026-10-10T10:00:00.000Z"), workspaceRef: "workspace:pinned" }),
        ],
      }),
    });
    expect(seat.colour).toBe("red");
    expect(seat.detail).toBe(
      "There seems to be a problem: it is running, but it has not said it is caught up or closed a sweep in the 10 minutes since it became the supervisor.",
    );
    // Red, and still live: its process runs, so the desktop never asks the owner to press recovery over it.
    expect(seat.live).toBe(true);
  });
});
