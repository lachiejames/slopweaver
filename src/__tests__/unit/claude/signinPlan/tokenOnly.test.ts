/*
 * The second axis a sign-in row grades: a store live on a setup token over its OWN credential. A signed-out or
 * unreadable store is token-only, never verified, a spent week does not mask that, and a signed-in one is
 * still verified or rate-limited.
 */
import { describe, expect, it } from "vitest";

import type { StoreLife } from "../../../../claude/credentialRepair.js";
import { planSignin } from "../../../../claude/signinPlan.js";
import { account, assertion, emptied, gauge, signedIn } from "./harness.js";

/** A store whose keychain item could not be read at all — absence and failure collapsed, as `readStoreLife` does. */
const unreadableStore = ({ alias }: { alias: string }): StoreLife => ({
  alias,
  hasCredential: false,
  hasRefreshToken: false,
  unreadable: true,
});

describe("planSignin", () => {
  // The defect: all five plan stores held an emptied credential while the verb printed
  // `5 of 5 live, 5 distinct account(s)` and VERIFIED on every row. `signinPlan.ts` § A row grades TWO axes.
  it("refuses to call a live setup token over a signed-out store verified", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [
        {
          alias: "plan-one",
          gauge: gauge({ alias: "plan-one" }),
          life: emptied({ alias: "plan-one" }),
          organizationId: "org-a",
        },
      ],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("token-only");
    expect(plan.rows[0]!.detail).toBe(
      "live on its setup token, but its own store is SIGNED OUT — no refresh repairs that, only one browser sign-in",
    );
    expect(plan.summary.live).toBe(1);
    expect(plan.summary.verified).toBe(0);
    expect(plan.summary.tokenOnly).toBe(1);
    expect(plan.summary.complete).toBe(false);
    expect(plan.summary.remaining).toEqual(["plan-one"]);
  });

  it("says the store could not be READ rather than that it is signed out, when that is all it knows", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [
        {
          alias: "plan-one",
          gauge: gauge({ alias: "plan-one" }),
          life: unreadableStore({ alias: "plan-one" }),
          organizationId: "org-a",
        },
      ],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("token-only");
    expect(plan.rows[0]!.detail).toBe(
      "live on its setup token, and its own store's credential could not be read this pass — nothing here proves a sign-in",
    );
  });

  it("still calls a live store that holds its OWN login verified, so the new branch cannot over-fire", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [
        {
          alias: "plan-one",
          gauge: gauge({ alias: "plan-one" }),
          life: signedIn({ alias: "plan-one" }),
          organizationId: "org-a",
        },
      ],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("verified");
    expect(plan.rows[0]!.detail).toBe("live on its own store, windows read, and the account matches its enrollment");
    expect(plan.summary.tokenOnly).toBe(0);
    expect(plan.summary.complete).toBe(true);
  });

  // `rate-limited` counts toward `verified`, so grading the wall first would let a whole fleet of signed-out
  // stores exit 0 the week every plan hit its window. The wall is kept in the detail rather than in the state.
  it("keeps a spent week token-only, and names the wall in the detail rather than dropping it", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [
        {
          alias: "plan-one",
          gauge: gauge({ alias: "plan-one", sevenDay: 1, sevenDayStatus: "rejected" }),
          life: emptied({ alias: "plan-one" }),
          organizationId: "org-a",
        },
      ],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("token-only");
    expect(plan.rows[0]!.detail).toBe(
      "live on its setup token, but its own store is SIGNED OUT — no refresh repairs that, only one browser " +
        "sign-in, and its plan-wide week is spent",
    );
    expect(plan.summary.tokenOnly).toBe(1);
    expect(plan.summary.verified).toBe(0);
    expect(plan.summary.complete).toBe(false);
  });

  // The old ordering's corner, kept as its own case: every plan walled on the same week is precisely when a
  // `rate-limited`-first grade exited 0 over a fleet that had no login anywhere.
  it("refuses to call a fleet complete when every plan is walled over a store holding no login", () => {
    const aliases = ["plan-one", "plan-two", "plan-three", "plan-four"];
    const plan = planSignin({
      accounts: aliases.map((alias) => account({ alias })),
      assertions: aliases.map((alias, index) => assertion({ alias, organizationId: `org-${String(index)}` })),
      probes: aliases.map((alias, index) => ({
        alias,
        gauge: gauge({ alias, sevenDay: 1, sevenDayStatus: "rejected" }),
        life: emptied({ alias }),
        organizationId: `org-${String(index)}`,
      })),
      signIns: [],
    });

    expect(plan.summary.complete).toBe(false);
    expect(plan.summary.verified).toBe(0);
    expect(plan.summary.tokenOnly).toBe(4);
    expect(plan.summary.remaining).toEqual(aliases);
  });

  // A store that holds its OWN login still reads the wall as the wall — the new ordering must not swallow it.
  it("still reports a spent week on a signed-in store as rate-limited", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [
        {
          alias: "plan-one",
          gauge: gauge({ alias: "plan-one", sevenDay: 1, sevenDayStatus: "rejected" }),
          life: signedIn({ alias: "plan-one" }),
          organizationId: "org-a",
        },
      ],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("rate-limited");
    expect(plan.rows[0]!.detail).toBe("signed in and correct; its plan-wide week is spent");
    expect(plan.summary.tokenOnly).toBe(0);
  });

  it("reproduces the measured five-store shape: every plan live and distinct, none of them verified", () => {
    const aliases = ["plan-one", "plan-two", "plan-three", "plan-four", "plan-five"];
    const plan = planSignin({
      accounts: aliases.map((alias) => account({ alias })),
      assertions: aliases.map((alias, index) => assertion({ alias, organizationId: `org-${String(index)}` })),
      probes: aliases.map((alias, index) => ({
        alias,
        gauge: gauge({ alias }),
        life: emptied({ alias }),
        organizationId: `org-${String(index)}`,
      })),
      signIns: [],
    });

    expect(plan.rows.filter((row) => row.state === "token-only")).toHaveLength(5);
    expect(plan.summary.live).toBe(5);
    expect(plan.summary.distinctAccounts).toBe(5);
    expect(plan.summary.verified).toBe(0);
    expect(plan.summary.tokenOnly).toBe(5);
    expect(plan.summary.complete).toBe(false);
    expect(plan.summary.remaining).toEqual(aliases);
  });

  it("grades a store it was handed no reading for as unknown rather than as signed out", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-a" }],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("verified");
    expect(plan.summary.tokenOnly).toBe(0);
  });
});
