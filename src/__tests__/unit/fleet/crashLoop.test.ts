/**
 * A seat recovery keeps relaunching is held for the supervisor to investigate, never relaunched a fourth time — and
 * an ordinary run of restarts never trips it.
 */
import { describe, expect, it } from "vitest";

import { crashLoopingSeats } from "../../../fleet/crashLoop.js";
import type { FleetJournalEvent } from "../../../fleet/journal.js";

const NOW = "2026-10-04T06:00:00.000Z";

/** One `reseated` line for a seat in an attempt. */
function reseated({ ref, attemptId, atIso }: { ref: string; attemptId: string; atIso: string }): FleetJournalEvent {
  return { atIso, attemptId, kind: "seat", phase: "reseated", role: "worker", schemaVersion: 1, workspaceRef: ref };
}

describe("crashLoopingSeats", () => {
  it("names a seat relaunched in three distinct attempts inside the hour", () => {
    const events = [
      reseated({ atIso: "2026-10-04T05:10:00.000Z", attemptId: "a1", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:30:00.000Z", attemptId: "a2", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:50:00.000Z", attemptId: "a3", ref: "workspace:7" }),
    ];
    expect([...crashLoopingSeats({ events, nowIso: NOW }).values()]).toEqual([
      { reseats: 3, sinceIso: "2026-10-04T05:10:00.000Z", workspaceRef: "workspace:7" },
    ]);
  });

  it("does not trip on two relaunches, the boundary below the threshold", () => {
    const events = [
      reseated({ atIso: "2026-10-04T05:30:00.000Z", attemptId: "a1", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:50:00.000Z", attemptId: "a2", ref: "workspace:7" }),
    ];
    expect(crashLoopingSeats({ events, nowIso: NOW }).size).toBe(0);
  });

  it("never trips on three restarts across a day, each relaunching every seat once", () => {
    const events = ["2026-10-03T22:00:00.000Z", "2026-10-04T02:00:00.000Z", "2026-10-04T05:30:00.000Z"].flatMap(
      (atIso, index) => [
        reseated({ atIso, attemptId: `r${String(index)}`, ref: "workspace:7" }),
        reseated({ atIso, attemptId: `r${String(index)}`, ref: "workspace:8" }),
      ],
    );
    expect(crashLoopingSeats({ events, nowIso: NOW }).size).toBe(0);
  });

  it("counts a relaunch exactly an hour old, and drops one a millisecond older", () => {
    const inside = [
      reseated({ atIso: "2026-10-04T05:00:00.000Z", attemptId: "a1", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:30:00.000Z", attemptId: "a2", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:50:00.000Z", attemptId: "a3", ref: "workspace:7" }),
    ];
    const outside = [
      reseated({ atIso: "2026-10-04T04:59:59.999Z", attemptId: "a1", ref: "workspace:7" }),
      ...inside.slice(1),
    ];
    expect(crashLoopingSeats({ events: inside, nowIso: NOW }).get("workspace:7")!.reseats).toBe(3);
    expect(crashLoopingSeats({ events: outside, nowIso: NOW }).size).toBe(0);
  });

  it("counts one attempt once, however many lines it wrote for the seat", () => {
    const events = [
      reseated({ atIso: "2026-10-04T05:10:00.000Z", attemptId: "a1", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:11:00.000Z", attemptId: "a1", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:30:00.000Z", attemptId: "a2", ref: "workspace:7" }),
    ];
    expect(crashLoopingSeats({ events, nowIso: NOW }).size).toBe(0);
  });

  it("counts neither an instant after now nor one that will not parse", () => {
    const events = [
      reseated({ atIso: "2026-10-04T05:30:00.000Z", attemptId: "a1", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:50:00.000Z", attemptId: "a2", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T06:00:00.001Z", attemptId: "a3", ref: "workspace:7" }),
      reseated({ atIso: "not a time", attemptId: "a4", ref: "workspace:7" }),
    ];
    expect(crashLoopingSeats({ events, nowIso: NOW }).size).toBe(0);
  });

  it("keeps each seat's count to itself", () => {
    const events = [
      reseated({ atIso: "2026-10-04T05:10:00.000Z", attemptId: "a1", ref: "workspace:7" }),
      reseated({ atIso: "2026-10-04T05:20:00.000Z", attemptId: "a2", ref: "workspace:8" }),
      reseated({ atIso: "2026-10-04T05:30:00.000Z", attemptId: "a3", ref: "workspace:9" }),
    ];
    expect(crashLoopingSeats({ events, nowIso: NOW }).size).toBe(0);
  });

  it("ignores a refused or held seat, since only a relaunch that worked can fall over again", () => {
    const events: FleetJournalEvent[] = ["a1", "a2", "a3"].map((attemptId) => ({
      atIso: "2026-10-04T05:30:00.000Z",
      attemptId,
      kind: "seat",
      phase: "refused",
      role: "worker",
      schemaVersion: 1,
      workspaceRef: "workspace:7",
    }));
    expect(crashLoopingSeats({ events, nowIso: NOW }).size).toBe(0);
  });
});
