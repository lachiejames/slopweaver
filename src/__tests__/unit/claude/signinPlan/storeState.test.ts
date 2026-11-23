/*
 * How `planSignin` grades each configured store on the account axis — needs-sign-in, unverified, verified,
 * wrong-account, unbound, rate-limited, duplicate — and when the summary calls the whole set complete.
 */
import { describe, expect, it } from "vitest";

import { planSignin } from "../../../../claude/signinPlan.js";
import { account, assertion, gauge, NO_LOGIN } from "./harness.js";

describe("planSignin", () => {
  it("calls a store with no login needs-sign-in, and offers it as remaining", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-two" })],
      assertions: [],
      probes: [{ alias: "plan-two", problem: NO_LOGIN }],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("needs-sign-in");
    expect(plan.rows[0]!.detail).toBe("no login in this store — one browser sign-in repairs it");
    expect(plan.rows[0]!.windows).toBeUndefined();
    expect(plan.summary.remaining).toEqual(["plan-two"]);
    expect(plan.summary.live).toBe(0);
    expect(plan.summary.complete).toBe(false);
  });

  it("separates an unreadable store from a logged-out one, and does not offer it for sign-in", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-two" })],
      assertions: [],
      probes: [{ alias: "plan-two", problem: "the probe request could not be completed" }],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("unverified");
    expect(plan.rows[0]!.detail).toBe(
      "a credential exists but could not be read this pass: the probe request could not be completed",
    );
    expect(plan.summary.remaining).toEqual([]);
  });

  it("reports a live enrolled store as verified, with its three windows as percentages", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one", fable: 0.12 }), organizationId: "org-a" }],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("verified");
    expect(plan.rows[0]!.windows).toEqual({
      fiveHourPercent: 47,
      sevenDayPercent: 10,
      sevenDayFablePercent: 12,
    });
    expect(plan.summary.complete).toBe(true);
    expect(plan.summary.distinctAccounts).toBe(1);
  });

  it("calls a live store holding a different account wrong-account, and offers it as remaining", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-REPLACED" }],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("wrong-account");
    expect(plan.rows[0]!.detail).toBe(
      "live, but NOT the account enrolled for this store on 2026-09-09T05:00:00.000Z — a sign-in replaced it",
    );
    expect(plan.summary.remaining).toEqual(["plan-one"]);
    expect(plan.summary.complete).toBe(false);
  });

  it("calls a live store with no enrollment unbound rather than green", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-a" }],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("unbound");
    expect(plan.rows[0]!.detail).toBe("live, but no account has been enrolled for this store yet");
    expect(plan.summary.verified).toBe(0);
    expect(plan.summary.complete).toBe(false);
  });

  it("calls a signed-in store whose week the provider REFUSED rate-limited, never needs-sign-in", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [
        {
          alias: "plan-one",
          gauge: gauge({ alias: "plan-one", sevenDay: 1, sevenDayStatus: "rejected" }),
          organizationId: "org-a",
        },
      ],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("rate-limited");
    expect(plan.rows[0]!.detail).toBe("signed in and correct; its plan-wide week is spent");
    expect(plan.summary.remaining).toEqual([]);
    expect(plan.summary.complete).toBe(true);
  });

  it("catches the same account signed into two stores, and marks BOTH rows", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-two" }), account({ alias: "plan-three" })],
      assertions: [],
      probes: [
        { alias: "plan-two", gauge: gauge({ alias: "plan-two" }), organizationId: "org-same" },
        { alias: "plan-three", gauge: gauge({ alias: "plan-three" }), organizationId: "org-same" },
      ],
      signIns: [],
    });

    expect(plan.rows[0]!.state).toBe("duplicate");
    expect(plan.rows[1]!.state).toBe("duplicate");
    expect(plan.summary.live).toBe(2);
    expect(plan.summary.distinctAccounts).toBe(1);
    expect(plan.summary.complete).toBe(false);
    expect(plan.summary.remaining).toEqual(["plan-two", "plan-three"]);
  });

  it("is complete only when every plan is live, distinct AND enrolled", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" }), account({ alias: "plan-two" })],
      assertions: [
        assertion({ alias: "plan-one", organizationId: "org-a" }),
        assertion({ alias: "plan-two", organizationId: "org-b" }),
      ],
      probes: [
        { alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-a" },
        { alias: "plan-two", gauge: gauge({ alias: "plan-two" }), organizationId: "org-b" },
      ],
      signIns: [],
    });

    expect(plan.summary.complete).toBe(true);
    expect(plan.summary.distinctAccounts).toBe(2);
    expect(plan.summary.verified).toBe(2);
  });

  it("reports a configured plan that was never probed rather than dropping it", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" }), account({ alias: "plan-four" })],
      assertions: [],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-a" }],
      signIns: [],
    });

    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[1]!.alias).toBe("plan-four");
    expect(plan.rows[1]!.state).toBe("unverified");
    expect(plan.summary.configured).toBe(2);
  });
});
