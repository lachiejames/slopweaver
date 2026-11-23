/**
 * A seat whose session is gone after the attempt: no row and nothing called down for one reseated or journalled
 * gone, while a refused seat with no session still reads red.
 */
import { describe, expect, it } from "vitest";

import type { FleetJournalEvent } from "../../../../fleet/journal.js";
import { judgeFleet } from "../../../../fleet/judge.js";
import { CHAIR, evidence, journalled } from "./harness.js";

describe("judgeFleet", () => {
  describe("a seat whose session is gone after the attempt", () => {
    const base = { attemptId: "att", schemaVersion: 1 as const };
    const GONE = "a0000011-0000-4000-8000-000000000012";
    const started: FleetJournalEvent = {
      ...base,
      atIso: "2026-10-04T05:00:01.000Z",
      episodeId: "ep",
      kind: "attempt-started",
      pid: 42,
    };
    const reoriented: FleetJournalEvent = {
      ...base,
      atIso: "2026-10-04T05:01:00.000Z",
      chairSessionId: CHAIR,
      kind: "chair-reoriented",
    };
    const reseatedThenClosed: FleetJournalEvent = {
      ...base,
      atIso: "2026-10-04T05:00:05.000Z",
      kind: "seat",
      phase: "reseated",
      role: "worker",
      sessionId: GONE,
      workspaceRef: "workspace:3",
    };

    it("shows no row for a seat it reseated whose session has since ended, and calls nothing down for it", () => {
      const events: FleetJournalEvent[] = [
        started,
        reoriented,
        reseatedThenClosed,
        { ...base, atIso: "2026-10-04T05:00:10.000Z", kind: "attempt-finished", outcome: "healthy" },
      ];
      const document = judgeFleet({ evidence: evidence({ ...journalled({ events }) }) });
      expect(document.seats.filter((seat) => seat.role === "worker").map((seat) => seat.rowTitle)).toEqual(["A row"]);
      expect(document.state).toBe("healthy");
    });

    it("still paints a refused seat with no session red beside it, and calls the fleet down for that one alone", () => {
      const events: FleetJournalEvent[] = [
        started,
        reoriented,
        reseatedThenClosed,
        {
          ...base,
          atIso: "2026-10-04T05:00:09.000Z",
          kind: "seat",
          phase: "refused",
          refusal: { code: "KILL_TIMEOUT", message: "still running 15s after SIGTERM", workspaceRef: "workspace:5" },
          role: "worker",
          workspaceRef: "workspace:5",
        },
        { ...base, atIso: "2026-10-04T05:00:10.000Z", kind: "attempt-finished", outcome: "failed" },
      ];
      const document = judgeFleet({ evidence: evidence({ ...journalled({ events }) }) });
      expect(
        document.seats.filter((seat) => seat.role === "worker").map((seat) => [seat.rowTitle, seat.colour]),
      ).toEqual([
        ["A row", "green"],
        ["workspace:5", "red"],
      ]);
      expect(document.state).toBe("down");
    });

    it("shows no row and calls nothing down for a refused seat close-done journalled gone, headlining nothing of it", () => {
      const events: FleetJournalEvent[] = [
        started,
        reoriented,
        reseatedThenClosed,
        {
          ...base,
          atIso: "2026-10-04T05:00:09.000Z",
          kind: "seat",
          phase: "refused",
          refusal: { code: "KILL_TIMEOUT", message: "still running 15s after SIGTERM", workspaceRef: "workspace:5" },
          role: "worker",
          workspaceRef: "workspace:5",
        },
        { ...base, atIso: "2026-10-04T05:00:10.000Z", kind: "attempt-finished", outcome: "failed" },
        { ...base, atIso: "2026-10-04T05:09:00.000Z", kind: "seat-gone", workspaceRef: "workspace:5" },
      ];
      const document = judgeFleet({ evidence: evidence({ ...journalled({ events }) }) });
      expect(document.seats.filter((seat) => seat.role === "worker").map((seat) => seat.rowTitle)).toEqual(["A row"]);
      expect(document.state).toBe("healthy");
      expect(document.reason.code).toBe("HEALTHY");
      expect(document.lastAttempt).toEqual({ attemptId: "att", episodeId: "ep", outcome: "failed" });
    });
  });
});
