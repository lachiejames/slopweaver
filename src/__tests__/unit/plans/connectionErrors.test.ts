/**
 * The words a plan Connect verb prints when it could not do what it was asked: each factory's code, the fields a
 * caller branches on, and the message the console and the terminal show.
 */
import { describe, expect, it } from "vitest";

import { PlanConnectionErrors, registerReason, StoreKeptErrors } from "../../../plans/connectionErrors.js";
import { PlanRegisterErrors } from "../../../plans/errors.js";

/** A register read that failed on a store it could not open — its own message names `slopweaver store status`. */
const STORE_DOWN = PlanRegisterErrors.registerStoreUnavailable({ doing: "open", reason: "locked" });

describe("PlanConnectionErrors", () => {
  it("names the attempt a refused Cancel, a superseded worker or a second Connect was about", () => {
    expect(PlanConnectionErrors.notFound({ id: "0123abcd4567ef89" })).toEqual({
      code: "CONNECTION_NOT_FOUND",
      id: "0123abcd4567ef89",
      message: "no sign-in attempt has the id 0123abcd4567ef89",
    });
    expect(PlanConnectionErrors.superseded({ id: "0123abcd4567ef89" })).toEqual({
      code: "CONNECTION_SUPERSEDED",
      id: "0123abcd4567ef89",
      message: "sign-in attempt 0123abcd4567ef89 was replaced by a later one, so its record was left alone",
    });
    expect(PlanConnectionErrors.inFlight({ id: "0123abcd4567ef89" }).message).toBe(
      "a sign-in is already in progress (0123abcd4567ef89) — finish or cancel it first",
    );
  });

  it("says which file could not be read or written, and why", () => {
    expect(PlanConnectionErrors.unreadable({ cause: "EACCES", path: "/h/codex.json" })).toEqual({
      code: "CONNECTION_UNREADABLE",
      message: "/h/codex.json could not be read: EACCES",
      path: "/h/codex.json",
    });
    expect(PlanConnectionErrors.unwritable({ cause: "ENOSPC", path: "/h/codex.json" })).toEqual({
      code: "CONNECTION_UNWRITABLE",
      message: "/h/codex.json could not be written: ENOSPC",
      path: "/h/codex.json",
    });
  });

  it("words a start that raced another, a provider not built yet, and a register or launch that failed", () => {
    expect(PlanConnectionErrors.starting()).toEqual({
      code: "CONNECTION_STARTING",
      message: "another sign-in is being started right now — try again in a moment",
    });
    expect(PlanConnectionErrors.unsupported({ host: "claude" })).toEqual({
      code: "CONNECTION_UNSUPPORTED",
      host: "claude",
      message: "connecting a claude plan from the console is not built yet",
    });
    expect(PlanConnectionErrors.registerUnreadable({ error: STORE_DOWN }).message).toBe(
      "the plan register could not be read: the store that holds the plan register could not be reached",
    );
    expect(PlanConnectionErrors.launchFailed({ cause: "no shell" }).message).toBe(
      "the sign-in could not be started in the background: no shell",
    );
  });

  it("carries the failure under a store left behind, and names the store", () => {
    const cause = PlanConnectionErrors.unwritable({ cause: "ENOSPC", path: "/h/codex.json" });
    const left = PlanConnectionErrors.storeLeft({ cause, removal: "EBUSY", storeDir: "/h/codex-accounts/codex" });

    expect(left.code).toBe("CONNECTION_STORE_LEFT_BEHIND");
    expect(left.cause).toBe(cause);
    expect(left.storeDir).toBe("/h/codex-accounts/codex");
    expect(left.message).toBe(
      "/h/codex.json could not be written: ENOSPC; /h/codex-accounts/codex was left behind, and no plan names it: EBUSY",
    );
  });

  it("says why a store an attempt names is not one it may touch", () => {
    expect(PlanConnectionErrors.foreignStore({ reason: "a plan uses", storeDir: "/h/x" })).toEqual({
      code: "CONNECTION_STORE_FOREIGN",
      message: "the sign-in attempt names /h/x, which a plan uses, so it was neither signed into nor removed",
      storeDir: "/h/x",
    });
  });
});

describe("StoreKeptErrors", () => {
  it("words each reason a worker kept a store rather than remove it", () => {
    expect(
      [
        StoreKeptErrors.notConnects({ alias: "codex-2" }),
        StoreKeptErrors.planHolds({ alias: "codex-2" }),
        StoreKeptErrors.registerUnreadable({ error: STORE_DOWN }),
        StoreKeptErrors.removalFailed({ cause: "EBUSY" }),
        StoreKeptErrors.reservationNotOurs(),
        StoreKeptErrors.reservationUnreadable({ cause: "EACCES" }),
      ].map((kept) => `${kept.code}: ${kept.message}`),
    ).toEqual([
      "NOT_CONNECTS_STORE: it is not the store a Connect reserves for codex-2, so it was not removed",
      "PLAN_HOLDS_STORE: the plan codex-2 now uses it, so it was not removed",
      "REGISTER_UNREADABLE: the register could not be read to check no plan uses it: the store that holds the plan " +
        "register could not be reached",
      "REMOVAL_FAILED: EBUSY",
      "RESERVATION_NOT_OURS: it does not carry this attempt's reservation, so it was not removed",
      "RESERVATION_UNREADABLE: its reservation could not be read to check it is this attempt's: EACCES",
    ]);
  });
});

describe("registerReason", () => {
  it("never carries the register's own message, which for a store that is down names a command", () => {
    expect([STORE_DOWN.message.includes("slopweaver store status"), registerReason({ error: STORE_DOWN })]).toEqual([
      true,
      "the store that holds the plan register could not be reached",
    ]);
    expect(
      registerReason({
        error: PlanRegisterErrors.mutationConflict({
          conflict: "to refresh a cached Codex address, run slopweaver plans sync-accounts",
        }),
      }),
    ).toBe("the plan register refused this plan as it stands");
    expect(
      registerReason({ error: PlanRegisterErrors.unknownDestination({ alias: "codex-9", provider: "codex" }) }),
    ).toBe("no registered codex plan is called codex-9");
  });

  it("words every register failure without a command", () => {
    const errors = [
      PlanRegisterErrors.registerUnreadable({ path: "/h/plans.json" }),
      PlanRegisterErrors.registerInvalid({ problems: ["row 1 has no alias"] }),
      PlanRegisterErrors.unknownDestination({ alias: "codex-9", provider: "codex" }),
      PlanRegisterErrors.mutationConflict({ conflict: "run slopweaver plans sync-accounts" }),
      STORE_DOWN,
      PlanRegisterErrors.registerRevisionConflict({ expectedRevision: 3 }),
      PlanRegisterErrors.projectionWriteFailed({
        cause: new Error("disk full"),
        committedRevision: 4,
        paths: ["/h/p"],
      }),
      PlanRegisterErrors.seatPassesNotCleared({ cause: new Error("EACCES"), path: "/h/passes" }),
    ];

    expect(errors.length).toBe(8);
    expect(errors.map((error) => registerReason({ error })).filter((reason) => /slopweaver|`/.test(reason))).toEqual(
      [],
    );
  });
});
