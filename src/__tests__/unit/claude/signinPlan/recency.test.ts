/*
 * What a sign-in row says about time: the newest recorded sign-in, and the access and grant expiries read off a
 * store's own credential — absent when nothing was read or the store holds no grant, and kept through `--json`.
 */
import { describe, expect, it } from "vitest";

import { planSignin } from "../../../../claude/signinPlan.js";
import { account, assertion, emptied, gauge, NO_LOGIN, signedIn } from "./harness.js";

describe("planSignin", () => {
  it("carries the newest recorded sign-in for the store onto its row", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" }), account({ alias: "plan-two" })],
      assertions: [],
      probes: [
        { alias: "plan-one", problem: NO_LOGIN },
        { alias: "plan-two", problem: NO_LOGIN },
      ],
      signIns: [
        { alias: "plan-one", signedInAtIso: "2026-09-11T09:00:00.000Z" },
        { alias: "plan-one", signedInAtIso: "2026-09-12T08:00:00.000Z" },
      ],
    });

    expect(plan.rows[0]!.lastSignInAtIso).toBe("2026-09-12T08:00:00.000Z");
    expect(Object.keys(plan.rows[1]!).includes("lastSignInAtIso")).toBe(false);
  });

  it("carries both credential instants off a store whose own credential was read", () => {
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

    expect(plan.rows[0]!.accessExpiresAtIso).toBe("2026-09-19T23:59:00.000Z");
    expect(plan.rows[0]!.grantExpiresAtIso).toBe("2026-10-16T00:00:00.000Z");
  });

  // An unreadable reading carries no comparable instant whatever else it holds — the same guard
  // `credentialRepair.ts`'s `knownExpiryMs` had to build, because the TYPE permits what the producer never
  // emits. Reporting a deadline off a store nobody read this pass is reporting a deadline off nothing.
  it("emits neither expiry off a reading that explicitly could not be read, even when it carries instants", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", organizationId: "org-a" })],
      probes: [
        {
          alias: "plan-one",
          gauge: gauge({ alias: "plan-one" }),
          life: { ...signedIn({ alias: "plan-one" }), unreadable: true },
          organizationId: "org-a",
        },
      ],
      signIns: [],
    });

    expect(Object.keys(plan.rows[0]!).includes("accessExpiresAtIso")).toBe(false);
    expect(Object.keys(plan.rows[0]!).includes("grantExpiresAtIso")).toBe(false);
  });

  it("emits neither expiry when the shell supplied no reading at all", () => {
    const plan = planSignin({
      accounts: [account({ alias: "plan-one" })],
      assertions: [],
      probes: [{ alias: "plan-one", problem: NO_LOGIN }],
      signIns: [],
    });

    expect(Object.keys(plan.rows[0]!).includes("accessExpiresAtIso")).toBe(false);
    expect(Object.keys(plan.rows[0]!).includes("grantExpiresAtIso")).toBe(false);
  });

  // The shape: live on a setup token over a store holding no login of its own, so there is no
  // grant in this store to expire. It must read as absent rather than as a number taken from somewhere else.
  it("gives a token-only store no grant expiry, because its own store holds no grant", () => {
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
    expect(Object.keys(plan.rows[0]!).includes("grantExpiresAtIso")).toBe(false);
  });

  // `report` emits `JSON.stringify({ observedAtIso, ...plan })`, so the `--json` face is whatever survives
  // serialising a row. This is the third of the three faces the recency clauses have to reach.
  it("carries the recency and both expiries through the --json serialisation", () => {
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
      signIns: [{ alias: "plan-one", signedInAtIso: "2026-09-12T08:00:00.000Z" }],
    });
    const document = JSON.parse(JSON.stringify({ observedAtIso: "2026-09-12T09:00:00.000Z", ...plan })) as {
      rows: readonly Record<string, unknown>[];
    };

    expect(document.rows[0]!["lastSignInAtIso"]).toBe("2026-09-12T08:00:00.000Z");
    expect(document.rows[0]!["accessExpiresAtIso"]).toBe("2026-09-19T23:59:00.000Z");
    expect(document.rows[0]!["grantExpiresAtIso"]).toBe("2026-10-16T00:00:00.000Z");
  });
});
