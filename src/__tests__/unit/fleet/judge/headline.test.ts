/**
 * The headline a refusal earns: a sign-in naming the plan's email for a seat still walled, and a refusal no build
 * names kept under the fold rather than headlined.
 */
import { describe, expect, it } from "vitest";

import type { FleetJournalEvent } from "../../../../fleet/journal.js";
import { judgeFleet } from "../../../../fleet/judge.js";
import { CHAIR, evidence, journalled, session, WORKER } from "./harness.js";

describe("judgeFleet", () => {
  it("headlines a sign-in naming the plan's email when a reseated seat came back still walled", () => {
    const base = { attemptId: "att", schemaVersion: 1 as const };
    const events: FleetJournalEvent[] = [
      { ...base, atIso: "2026-10-04T05:00:01.000Z", episodeId: "ep", kind: "attempt-started", pid: 42 },
      {
        ...base,
        atIso: "2026-10-04T05:00:09.000Z",
        kind: "seat",
        phase: "refused",
        refusal: {
          alias: "plan-one",
          code: "SEAT_STILL_WALLED",
          message: "still Not logged in",
          workspaceRef: "workspace:2",
        },
        role: "worker",
        sessionId: WORKER,
        workspaceRef: "workspace:2",
      },
      { ...base, atIso: "2026-10-04T05:00:10.000Z", kind: "attempt-finished", outcome: "hand-step" },
    ];
    const document = judgeFleet({
      evidence: evidence({
        ...journalled({ events }),
        sessions: [
          session({ row: undefined, sessionId: CHAIR }),
          session({ boot: { alias: "plan-one", kind: "store" } }),
        ],
        signedOutStores: new Set(["plan-one"]),
      }),
    });
    expect(document.reason.headline).toBe("Sign in to one@example.com (plan-one).");
    expect(document.reason.handStep!.label).toBe("Sign in as one@example.com");
    expect(document.reason.handStep!.action).toEqual({
      alias: "plan-one",
      email: "one@example.com",
      kind: "claude-signin",
    });
  });

  it("keeps a refusal no build names under the fold, never as the headline", () => {
    const base = { attemptId: "att", schemaVersion: 1 as const };
    const events: FleetJournalEvent[] = [
      { ...base, atIso: "2026-10-04T05:00:01.000Z", episodeId: "ep", kind: "attempt-started", pid: 42 },
      {
        ...base,
        atIso: "2026-10-04T05:00:10.000Z",
        kind: "attempt-finished",
        outcome: "failed",
        refusal: { code: "UNKNOWN", message: "a new gate said no", originalCode: "SOME_FUTURE_GATE" },
      },
    ];
    const document = judgeFleet({
      evidence: evidence({ ...journalled({ events }), sessions: [session({ boot: { kind: "off-plan", why: "x" } })] }),
    });
    expect(document.reason.headline).toBe("Recovery stopped at a step Slopweaver does not understand yet.");
    expect(document.unmapped).toEqual(["SOME_FUTURE_GATE: a new gate said no"]);
  });
});
