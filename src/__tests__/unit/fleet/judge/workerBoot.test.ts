/**
 * A worker's colour from how it booted: the default login and a signed-out store red, an unreadable boot yellow
 * in fixed words, and every plan unreadable past the pass's wait calling the fleet down.
 */
import { describe, expect, it } from "vitest";

import { judgeFleet } from "../../../../fleet/judge.js";
import { CHAIR, evidence, session, WORKER } from "./harness.js";

describe("judgeFleet", () => {
  it("paints a worker that came back on the default login red, and calls the fleet down", () => {
    const document = judgeFleet({
      evidence: evidence({
        sessions: [
          session({ row: undefined, sessionId: CHAIR }),
          session({ boot: { kind: "off-plan", why: "default login" } }),
        ],
      }),
    });
    const worker = document.seats.find((seat) => seat.sessionId === WORKER)!;
    expect(worker.colour).toBe("red");
    expect(worker.detail).toBe("It came back on the default login, which no plan names — the wall a restart leaves.");
    expect(document.state).toBe("down");
    expect(document.reason.headline).toBe("1 seat is down.");
  });

  it("paints an unreadable boot yellow in fixed words, never the producer's diagnostic", () => {
    const document = judgeFleet({
      evidence: evidence({
        sessions: [
          session({ row: undefined, sessionId: CHAIR }),
          session({ boot: { kind: "unresolved", why: "PRODUCER TEXT" } }),
        ],
      }),
    });
    const worker = document.seats.find((seat) => seat.sessionId === WORKER)!;
    expect(worker.colour).toBe("yellow");
    expect(worker.detail).toBe("Running, but which plan it is on could not be read.");
  });

  it("calls the fleet down once every plan has stayed unreadable past the pass's wait, rather than settling forever", () => {
    const unresolved = { kind: "unresolved" as const, why: "PRODUCER TEXT" };
    const document = judgeFleet({
      evidence: evidence({
        nowIso: "2026-10-04T05:10:01.000Z",
        sessions: [session({ boot: unresolved, row: undefined, sessionId: CHAIR }), session({ boot: unresolved })],
      }),
    });
    const long = "Running, but which plan it is on has not been readable in the 10 minutes since it started.";
    expect(document.seats.filter((seat) => seat.detail === long).map((seat) => seat.colour)).toEqual(["red", "red"]);
    expect(document.state).toBe("down");
  });

  it("paints a store boot on a signed-out plan red", () => {
    const document = judgeFleet({
      evidence: evidence({
        sessions: [
          session({ row: undefined, sessionId: CHAIR }),
          session({ boot: { alias: "plan-two", kind: "store" } }),
        ],
        signedOutStores: new Set(["plan-two"]),
      }),
    });
    expect(document.seats.find((seat) => seat.sessionId === WORKER)!.colour).toBe("red");
  });
});
