/*
 * Which account a sign-in row names: the address its enrollment bound, a configured address only as a cache, none
 * on an unenrolled or wrong-account row, and never the organisation id it was handed.
 */
import { describe, expect, it } from "vitest";

import { planSignin } from "../../../../claude/signinPlan.js";
import { account, assertion, gauge, NO_LOGIN } from "./harness.js";

describe("planSignin", () => {
  it("never lets the configured address onto an unenrolled row as though it were the account", () => {
    const plan = planSignin({
      accounts: [{ ...account({ alias: "plan-one" }), email: "admin@example.invalid" }, account({ alias: "plan-two" })],
      assertions: [],
      probes: [
        { alias: "plan-one", problem: NO_LOGIN },
        { alias: "plan-two", problem: NO_LOGIN },
      ],
      signIns: [],
    });

    // plan-one HAS a configured address and the row still names none: nothing was enrolled, so nothing
    // bound one. Feeding the address in is what makes this falsifiable rather than a test of silence.
    expect(plan.rows[0]!.account).toEqual({ trust: "unenrolled" });
    expect(plan.rows[1]!.account).toEqual({ trust: "unenrolled" });
  });

  it("names the address its ENROLLMENT bound once the store's token matches it", () => {
    const plan = planSignin({
      accounts: [{ ...account({ alias: "plan-one" }), email: "admin@example.invalid" }],
      assertions: [assertion({ alias: "plan-one", email: "admin@example.invalid", organizationId: "org-1" })],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-1" }],
      signIns: [],
    });

    expect(plan.rows[0]!.account).toEqual({ address: "admin@example.invalid", trust: "bound" });
  });

  it("prefers the BOUND address and reports the drift when accounts.json has moved on", () => {
    const plan = planSignin({
      accounts: [{ ...account({ alias: "plan-one" }), email: "typo@example.invalid" }],
      assertions: [assertion({ alias: "plan-one", email: "admin@example.invalid", organizationId: "org-1" })],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-1" }],
      signIns: [],
    });

    expect(plan.rows[0]!.account).toEqual({
      address: "admin@example.invalid",
      staleCache: "typo@example.invalid",
      trust: "bound-cache-stale",
    });
  });

  it("calls the configured address a CACHE on a row enrolled before addresses were bound", () => {
    const plan = planSignin({
      accounts: [{ ...account({ alias: "plan-one" }), email: "admin@example.invalid" }],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-1" })],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-1" }],
      signIns: [],
    });

    expect(plan.rows[0]!.account).toEqual({ address: "admin@example.invalid", trust: "cached" });
    expect(plan.rows[0]!.state).toBe("verified");
  });

  it("names no address at all on a wrong-account row, and says in the SENTENCE what should be there", () => {
    const plan = planSignin({
      accounts: [{ ...account({ alias: "plan-one" }), email: "admin@example.invalid" }],
      assertions: [assertion({ alias: "plan-one", email: "admin@example.invalid", organizationId: "org-1" })],
      probes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-replaced" }],
      signIns: [],
    });

    expect(plan.rows[0]!.account).toEqual({ trust: "wrong-account" });
    expect(plan.rows[0]!.detail).toContain("(enrolled as admin@example.invalid)");
  });

  it("puts no organisation id on any row, whatever it was handed", () => {
    const assertions = [assertion({ alias: "plan-one", organizationId: "org-secret" })];
    const probes = [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }), organizationId: "org-secret" }];
    const plan = planSignin({ accounts: [account({ alias: "plan-one" })], assertions, probes, signIns: [] });

    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(assertions)).toContain("org-secret");
    expect(JSON.stringify(probes)).toContain("org-secret");
    expect(JSON.stringify(plan)).not.toContain("org-secret");
  });
});
