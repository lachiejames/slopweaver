/**
 * A seat the supervisor held as a crash loop: degraded with no button for the owner while it is the only red one, down
 * beside another red seat, recovering while its attempt runs, and healthy again once reseated.
 */
import { describe, expect, it } from "vitest";

import { judgeFleet } from "../../../../fleet/judge.js";
import { CHAIR, crashLoopHeld, evidence, journalled, session, WORKER } from "./harness.js";

describe("judgeFleet", () => {
  it("reads a fleet whose only red seat is a held crash loop as degraded, with no button for the owner", () => {
    const document = judgeFleet({
      evidence: evidence({
        ...journalled({ events: crashLoopHeld({ finished: true }) }),
        sessions: [
          session({ row: undefined, sessionId: CHAIR, workspaceRef: "workspace:1" }),
          session({ boot: { kind: "off-plan", why: "default login" } }),
        ],
      }),
    });
    const worker = document.seats.find((seat) => seat.sessionId === WORKER)!;
    expect(worker.colour).toBe("red");
    expect(worker.held).toBe(true);
    expect(document.seats.find((seat) => seat.sessionId === CHAIR)!.held).toBeUndefined();
    expect(worker.detail).toBe(
      "A seat keeps falling over after being brought back — the supervisor is investigating it instead.",
    );
    expect(document.state).toBe("degraded");
    expect(document.capacity.online).toBe(1);
    expect(document.reason.code).toBe("CRASH_LOOP");
    expect(document.reason.handStep).toBeUndefined();
  });

  it("still calls the fleet down when another seat is red beside the held one", () => {
    const document = judgeFleet({
      evidence: evidence({
        ...journalled({ events: crashLoopHeld({ finished: true }) }),
        loop: { detail: "Not listening.", live: false },
        sessions: [
          session({ row: undefined, sessionId: CHAIR, workspaceRef: "workspace:1" }),
          session({ boot: { kind: "off-plan", why: "default login" } }),
        ],
      }),
    });
    expect(document.state).toBe("down");
  });

  it("reads the held seat as recovering while its attempt still runs", () => {
    const document = judgeFleet({
      evidence: evidence({
        ...journalled({ events: crashLoopHeld({ finished: false }) }),
        attemptRunning: true,
        sessions: [
          session({ row: undefined, sessionId: CHAIR, workspaceRef: "workspace:1" }),
          session({ boot: { kind: "off-plan", why: "default login" } }),
        ],
      }),
    });
    expect(document.state).toBe("recovering");
  });

  it("returns to healthy once the supervisor has fixed and reseated the held seat, old refusal or not", () => {
    const document = judgeFleet({
      evidence: evidence({ ...journalled({ events: crashLoopHeld({ finished: true }) }) }),
    });
    expect(document.state).toBe("healthy");
  });
});
