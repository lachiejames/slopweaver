/**
 * The fleet as a whole: its state, the capacity line, the attempt it carries, a console that is down, empty slots,
 * and how worker seats are named and ordered.
 */
import { describe, expect, it } from "vitest";

import { judgeFleet } from "../../../../fleet/judge.js";
import { CHAIR, crashLoopHeld, evidence, journalled, session, WORKER } from "./harness.js";

describe("judgeFleet", () => {
  it("reads a reoriented chair, live services and a token-booted worker as healthy", () => {
    const document = judgeFleet({ evidence: evidence() });
    expect(document.state).toBe("healthy");
    expect(document.capacity).toEqual({ configured: 6, online: 2 });
    expect(document.reason.code).toBe("HEALTHY");
    expect(document.seats.map((seat) => [seat.role, seat.colour])).toEqual([
      ["supervisor", "green"],
      ["loop", "green"],
      ["keep-alive", "green"],
      ["worker", "green"],
      ["empty", "red"],
      ["empty", "red"],
      ["empty", "red"],
      ["empty", "red"],
    ]);
  });

  it("counts capacity in sessions alone: the two services neither fill a slot nor read as online", () => {
    const document = judgeFleet({ evidence: evidence({ config: { capacity: 15, schemaVersion: 1 } }) });
    expect(document.capacity).toEqual({ configured: 15, online: 2 });
    expect(document.seats.filter((seat) => seat.role !== "loop" && seat.role !== "keep-alive").length).toBe(15);
  });

  it("carries the newest finished attempt, with its id, so the desktop can continue a deferral once", () => {
    const document = judgeFleet({ evidence: evidence(journalled({ events: crashLoopHeld({ finished: true }) })) });
    expect(document.lastAttempt).toEqual({ attemptId: "att", episodeId: "ep", outcome: "deferred" });
    expect(document.newestAttempt).toEqual({ attemptId: "att", episodeId: "ep", finished: true });
  });

  it("names an attempt that started and never finished, which the finished-only field cannot", () => {
    const document = judgeFleet({ evidence: evidence(journalled({ events: crashLoopHeld({ finished: false }) })) });
    expect(document.lastAttempt).toBeUndefined();
    expect(document.newestAttempt).toEqual({ attemptId: "att", episodeId: "ep", finished: false });
  });

  it("names no attempt when the journal records none", () => {
    expect(judgeFleet({ evidence: evidence({}) }).newestAttempt).toBeUndefined();
  });

  it("calls the fleet down when only the console is down, and says so", () => {
    const document = judgeFleet({ evidence: evidence({ console: { state: "down" } }) });
    expect(document.state).toBe("down");
    expect(document.reason.code).toBe("CONSOLE_DOWN");
  });

  it("never lets empty slots make the fleet down", () => {
    const document = judgeFleet({ evidence: evidence({ config: { capacity: 15, schemaVersion: 1 } }) });
    expect(document.seats.length).toBe(17);
    expect(document.state).toBe("healthy");
  });

  it("names a seat no row claims by its directory's last segment, never the whole path", () => {
    const document = judgeFleet({
      evidence: evidence({
        sessions: [
          session({ row: undefined, sessionId: CHAIR }),
          session({ cwd: "/Users/me/.claude/worktrees.noindex/a-loose-seat", row: undefined }),
        ],
      }),
    });
    expect(document.seats.find((seat) => seat.sessionId === WORKER)!.rowTitle).toBe("a-loose-seat");
  });

  it("orders workers by their row's band, unassigned last", () => {
    const document = judgeFleet({
      evidence: evidence({
        sessions: [
          session({ row: undefined, sessionId: CHAIR }),
          session({ row: undefined, sessionId: "a" }),
          session({ row: { id: "low", priority: "p3", title: "Low" }, sessionId: "b" }),
          session({ row: { id: "top", priority: "p0", title: "Top" }, sessionId: "c" }),
        ],
      }),
    });
    expect(document.seats.filter((seat) => seat.role === "worker").map((seat) => seat.priority)).toEqual([
      "p0",
      "p3",
      "unassigned",
    ]);
  });
});
