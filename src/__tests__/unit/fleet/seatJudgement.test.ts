/**
 * What every seat is judged by: the wait a yellow seat is given, the credential wall, and the attempt's own phase.
 */
import { describe, expect, it } from "vitest";

import type { FleetEvidence, FleetLiveSession } from "../../../fleet/evidence.js";
import { foldNewestAttempt } from "../../../fleet/journal.js";
import { bootWall, inFlight, pastReorientWait, phaseFor, refusedDetail } from "../../../fleet/seatJudgement.js";

const NOW = "2026-10-10T06:00:00.000Z";

/** A quiet fleet at NOW, with no attempt and nothing pinned. */
function quiet({ attemptRunning }: { attemptRunning: boolean }): FleetEvidence {
  return {
    accounts: { emailFor: () => undefined },
    attempt: undefined,
    attemptRunning,
    chairPinnedAtIso: undefined,
    chairSessionId: undefined,
    chairSweep: { kind: "none" },
    chairWorkspaceRef: undefined,
    cmux: { kind: "answering" },
    config: { capacity: 2, schemaVersion: 1 },
    console: { port: 4000, state: "serving" },
    keepAlive: { detail: "Watching.", live: true },
    loop: { detail: "Listening.", live: true },
    nowIso: NOW,
    reorientations: new Map(),
    sessions: [],
    signedOutStores: new Set(),
  };
}

const LIVE: FleetLiveSession = {
  boot: { alias: "plan-two", kind: "store" },
  cwd: "/wt/b",
  row: undefined,
  sessionId: "a0000011-0000-4000-8000-000000000012",
  startedAtMs: Date.parse("2026-10-10T05:58:00.000Z"),
  workspaceRef: "workspace:7",
};

describe("pastReorientWait", () => {
  it("is false inside the ten-minute wait and true past it", () => {
    const evidence = quiet({ attemptRunning: false });
    expect(pastReorientWait({ evidence, fromMs: Date.parse("2026-10-10T05:55:00.000Z") })).toBe(false);
    expect(pastReorientWait({ evidence, fromMs: Date.parse("2026-10-10T05:49:00.000Z") })).toBe(true);
  });

  it("is true for a start later than now, so a future-dated record still ages out", () => {
    expect(
      pastReorientWait({ evidence: quiet({ attemptRunning: false }), fromMs: Date.parse("2026-10-10T07:00:00.000Z") }),
    ).toBe(true);
  });

  it("is false while a pass is running, however long ago the wait began", () => {
    expect(pastReorientWait({ evidence: quiet({ attemptRunning: true }), fromMs: 0 })).toBe(false);
  });
});

describe("bootWall", () => {
  it("names the default-login wall a restart leaves", () => {
    expect(bootWall({ boot: { kind: "off-plan", why: "no plan" }, signedOutStores: new Set() })).toBe(
      "It came back on the default login, which no plan names — the wall a restart leaves.",
    );
  });

  it("names a plan store whose own login is signed out, and passes one that is signed in", () => {
    expect(bootWall({ boot: LIVE.boot, signedOutStores: new Set(["plan-two"]) })).toBe(
      "It came back on plan-two's own login, which is signed out.",
    );
    expect(bootWall({ boot: LIVE.boot, signedOutStores: new Set(["plan-three"]) })).toBe(undefined);
  });
});

describe("phaseFor and inFlight", () => {
  const base = { attemptId: "a1", schemaVersion: 1 as const };
  const attempt = foldNewestAttempt({
    events: [
      { ...base, atIso: "2026-10-10T05:59:00.000Z", episodeId: "e1", kind: "attempt-started", pid: 7 },
      {
        ...base,
        atIso: "2026-10-10T05:59:01.000Z",
        kind: "seat",
        phase: "recovering",
        role: "worker",
        workspaceRef: "workspace:7",
      },
    ],
  });

  it("finds a seat by its workspace when no phase names its session, and is in flight only while running", () => {
    const phase = phaseFor({ attempt, session: LIVE });
    expect(phase!.workspaceRef).toBe("workspace:7");
    expect(inFlight({ phase, running: true })).toBe(true);
    expect(inFlight({ phase, running: false })).toBe(false);
  });

  it("finds nothing with no attempt", () => {
    expect(phaseFor({ attempt: undefined, session: LIVE })).toBe(undefined);
  });
});

describe("refusedDetail", () => {
  it("falls to the seat's own words when recovery refused nothing", () => {
    expect(
      refusedDetail({ evidence: quiet({ attemptRunning: false }), fallback: "Not running.", phase: undefined }),
    ).toBe("Not running.");
  });
});
