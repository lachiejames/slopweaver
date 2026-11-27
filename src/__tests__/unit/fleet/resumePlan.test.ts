/**
 * The resume pass's pure decisions: the order seats come back in, and how one attempt ends.
 */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { FleetAccountNames } from "../../../fleet/refusals.js";
import {
  attemptOutcome,
  crashLoopAction,
  fleetRefusalFromReseat,
  haltsLaterWorkers,
  orderResumeTargets,
  signInWhenNothingRoutes,
  stillWalledRefusal,
} from "../../../fleet/resumePlan.js";
import { ReseatErrors } from "../../../sessions/reseatErrors.js";

const ACCOUNTS: FleetAccountNames = { emailFor: () => undefined };

/** A workspace summary named by its ref. */
function workspace({ ref }: { ref: string }): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/wt",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: undefined,
    windowId: "window:1",
    workspaceId: `id-${ref}`,
    workspaceRef: ref,
  };
}

describe("orderResumeTargets", () => {
  it("puts the highest band first and a seat no row names last", () => {
    const ordered = orderResumeTargets({
      targets: [
        { priority: "unassigned", title: "z", workspace: workspace({ ref: "workspace:9" }) },
        { priority: "p2", title: "b", workspace: workspace({ ref: "workspace:3" }) },
        { priority: "p0", title: "a", workspace: workspace({ ref: "workspace:5" }) },
        { priority: "p2", title: "a", workspace: workspace({ ref: "workspace:4" }) },
      ],
    });
    expect(ordered.map((target) => target.workspace.workspaceRef)).toEqual([
      "workspace:5",
      "workspace:4",
      "workspace:3",
      "workspace:9",
    ]);
  });
});

describe("fleetRefusalFromReseat", () => {
  it("carries a routing refusal's kind and the plan it is about", () => {
    const error = ReseatErrors.storeRefused({ reason: "signed out", refusalKind: "configuration" });
    expect(fleetRefusalFromReseat({ alias: "plan-one", error, workspaceRef: "workspace:2" })).toEqual({
      alias: "plan-one",
      code: "STORE_REFUSED",
      message: "signed out",
      storeRefusal: "configuration",
      workspaceRef: "workspace:2",
    });
  });

  it("carries a split workspace through as its own code, never a failed read", () => {
    const error = ReseatErrors.splitSurfaces({ surfaces: 2, workspaceRef: "workspace:2" });
    expect(fleetRefusalFromReseat({ alias: undefined, error, workspaceRef: "workspace:2" })).toEqual({
      code: "SPLIT_SURFACES",
      message: error.message,
      workspaceRef: "workspace:2",
    });
  });
});

describe("crashLoopAction", () => {
  it("holds a looping worker and asks the supervisor to find the cause and reseat it itself", () => {
    const action = crashLoopAction({ reseats: 3, role: "worker", title: "a-row", workspaceRef: "workspace:7" });
    expect(action.kind).toBe("hold-worker");
    expect(action.refusal).toEqual({
      code: "CRASH_LOOP",
      message:
        "workspace:7 (a-row) was relaunched 3 times in the last hour and walled again each time, so it was held and the supervisor asked to investigate",
      workspaceRef: "workspace:7",
    });
    expect(action.investigationLine).toBe(
      "Recovery held workspace:7 (a-row) instead of relaunching it again: it was relaunched 3 times in the last hour and walled again each time. Investigate why it falls over after being brought back, fix the cause, and reseat it yourself once fixed — recovery will not.",
    );
  });

  it("never holds the supervisor: it is relaunched, and told it is the seat that keeps falling over", () => {
    const action = crashLoopAction({
      reseats: 4,
      role: "supervisor",
      title: "Supervisor",
      workspaceRef: "workspace:1",
    });
    expect(action.kind).toBe("reseat-chair");
    expect(action.refusal.message).toBe(
      "the supervisor (workspace:1) was relaunched 4 times in the last hour and walled again each time; it was relaunched rather than held, and asked to investigate",
    );
    expect(action.investigationLine.includes("\n")).toBe(false);
  });
});

describe("stillWalledRefusal", () => {
  it("refuses a relaunch still on a usage limit rather than counting it back", () => {
    const refusal = stillWalledRefusal({
      alias: "plan-one",
      wall: { banner: "Claude usage limit reached · retrying", kind: "limit-retrying" },
      workspaceRef: "workspace:3",
    });
    expect(refusal).toStrictEqual({
      alias: "plan-one",
      code: "SEAT_STILL_LIMITED",
      message: "workspace:3 relaunched and its screen still waits on a usage limit",
      workspaceRef: "workspace:3",
    });
    expect(haltsLaterWorkers({ code: refusal.code, role: "worker" })).toBe(true);
  });

  it("refuses a relaunch still signed out as a sign-in wall, naming no plan when none is known", () => {
    expect(
      stillWalledRefusal({ alias: undefined, wall: { kind: "logged-out" }, workspaceRef: "workspace:4" }),
    ).toStrictEqual({
      code: "SEAT_STILL_WALLED",
      message: 'workspace:4 relaunched and its screen still reads "Not logged in"',
      workspaceRef: "workspace:4",
    });
  });
});

describe("haltsLaterWorkers", () => {
  const stopped = [
    "KILL_TIMEOUT",
    "RELAUNCH_FAILED",
    "UNCONFIRMED",
    "SEAT_STILL_WALLED",
    "SEAT_STILL_LIMITED",
  ] as const;

  it("halts on every refusal a WORKER raised after it was stopped", () => {
    expect(stopped.map((code) => haltsLaterWorkers({ code, role: "worker" }))).toStrictEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("halts on a failing relaunch path from the chair, never on the chair still walled on its own store", () => {
    expect(stopped.map((code) => haltsLaterWorkers({ code, role: "supervisor" }))).toStrictEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("lets the others go on after a refusal raised before the stop", () => {
    const codes = [
      "STORE_REFUSED",
      "MODEL_REFUSED",
      "BUSY",
      "NO_LIVE_SESSION",
      "CMUX_READ_FAILED",
      "RESEAT_CONTENDED",
      "RESEAT_LOCK_FAILED",
    ] as const;
    expect(codes.map((code) => haltsLaterWorkers({ code, role: "worker" }))).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("signInWhenNothingRoutes", () => {
  const bare = { hasToken: false, paused: false, signedIn: false };

  it("names the register's first plan when no plan has a token or a login left", () => {
    expect(
      signInWhenNothingRoutes({
        plans: [
          { ...bare, alias: "plan-one" },
          { ...bare, alias: "plan-two" },
        ],
      }),
    ).toBe("plan-one");
  });

  it("names nobody when one plan still holds a token — the gauges failed, not the logins", () => {
    expect(
      signInWhenNothingRoutes({
        plans: [
          { ...bare, alias: "plan-one" },
          { ...bare, alias: "plan-two", hasToken: true },
        ],
      }),
    ).toBe(undefined);
  });

  it("names nobody when one plan's own store is still signed in", () => {
    expect(
      signInWhenNothingRoutes({
        plans: [
          { ...bare, alias: "plan-one", signedIn: true },
          { ...bare, alias: "plan-two" },
        ],
      }),
    ).toBe(undefined);
  });

  it("skips a paused plan, both as the one to name and as the one holding a credential", () => {
    expect(
      signInWhenNothingRoutes({
        plans: [
          { ...bare, alias: "plan-one", hasToken: true, paused: true },
          { ...bare, alias: "plan-two" },
        ],
      }),
    ).toBe("plan-two");
  });

  it("names nobody when there is no plan to sign in", () => {
    expect(signInWhenNothingRoutes({ plans: [] })).toBe(undefined);
  });
});

describe("attemptOutcome", () => {
  it("is a hand step whenever a refusal offers the owner a button", () => {
    expect(
      attemptOutcome({
        accounts: ACCOUNTS,
        deferred: true,
        refusals: [
          { code: "BUSY", message: "b" },
          { alias: "p", code: "SEAT_STILL_WALLED", message: "s" },
        ],
      }),
    ).toBe("hand-step");
  });

  it("is deferred, not failed, when the supervisor has not said it is caught up yet", () => {
    expect(
      attemptOutcome({
        accounts: ACCOUNTS,
        deferred: true,
        refusals: [{ code: "CHAIR_REORIENTATION_TIMEOUT", message: "t" }],
      }),
    ).toBe("deferred");
  });

  it("is deferred, not failed, when the only refusal is a crash loop handed to the supervisor", () => {
    expect(
      attemptOutcome({
        accounts: ACCOUNTS,
        deferred: false,
        refusals: [{ code: "CRASH_LOOP", message: "c", workspaceRef: "workspace:7" }],
      }),
    ).toBe("deferred");
  });

  // A seat relaunched FRESH is not back, and nothing failed: close-done re-seats an idle seat with no pickup.
  it("is deferred, never healthy, when a seat came back fresh with no conversation", () => {
    expect(
      attemptOutcome({
        accounts: ACCOUNTS,
        deferred: false,
        refusals: [{ code: "SEAT_NOT_RESUMED", message: "f", workspaceRef: "workspace:7" }],
      }),
    ).toBe("deferred");
  });

  it("is failed on a refusal with no button", () => {
    expect(
      attemptOutcome({ accounts: ACCOUNTS, deferred: false, refusals: [{ code: "KILL_TIMEOUT", message: "k" }] }),
    ).toBe("failed");
  });

  it("is healthy when nothing was refused or held", () => {
    expect(attemptOutcome({ accounts: ACCOUNTS, deferred: false, refusals: [] })).toBe("healthy");
  });
});
