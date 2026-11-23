import { describe, expect, it } from "vitest";

import type { ClaudeAccount, ClaudeAccountGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import type { ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import { type WatchIdentityProbe, watchIdentityAlarms } from "../../../claude/watchIdentity.js";

const ENROLLED_AT = "2026-10-20T05:00:00.000Z";

const window = ({ utilization }: { utilization: number }): ClaudeWindowReading => ({
  resetAtIso: "2026-10-28T03:00:00.000Z",
  status: "allowed",
  utilization,
});

/** The byte-identical gauge two stores read under one organisation in the incident. */
const gauge = ({ alias }: { alias: string }): ClaudeAccountGauge => ({
  alias,
  fiveHour: window({ utilization: 0.31 }),
  observedAtIso: "2026-10-28T04:00:00.000Z",
  sevenDay: window({ utilization: 0.42 }),
});

const account = ({ alias }: { alias: string }): ClaudeAccount => ({ alias, storeDir: `/stores/${alias}` });

const assertion = ({
  alias,
  email,
  organizationId,
}: {
  alias: string;
  email?: string;
  organizationId: string;
}): ClaudeIdentityAssertion => ({
  alias,
  assertedAtIso: ENROLLED_AT,
  organizationId,
  ...(email === undefined ? {} : { email }),
});

const live = ({ alias, organizationId }: { alias: string; organizationId: string }): WatchIdentityProbe => ({
  organizationId,
  outcome: { alias, gauge: gauge({ alias }) },
});

const ACCOUNTS = [account({ alias: "plan-one" }), account({ alias: "plan-two" })];

const ASSERTIONS = [
  assertion({ alias: "plan-one", organizationId: "org-FIXTURE-one" }),
  assertion({ alias: "plan-two", email: "two@acme.example", organizationId: "org-FIXTURE-two" }),
];

describe("watchIdentityAlarms", () => {
  it("prints nothing when every live store holds its own enrolled, distinct account", () => {
    const alarms = watchIdentityAlarms({
      accounts: ACCOUNTS,
      assertions: ASSERTIONS,
      probes: [
        live({ alias: "plan-one", organizationId: "org-FIXTURE-one" }),
        live({ alias: "plan-two", organizationId: "org-FIXTURE-two" }),
      ],
    });

    expect(alarms).toEqual([]);
  });

  it("names WRONG ACCOUNT, with the enrolled address, when a store's organisation changed", () => {
    const alarms = watchIdentityAlarms({
      accounts: ACCOUNTS,
      assertions: ASSERTIONS,
      probes: [
        live({ alias: "plan-one", organizationId: "org-FIXTURE-one" }),
        live({ alias: "plan-two", organizationId: "org-FIXTURE-other" }),
      ],
    });

    expect(alarms).toEqual([
      `plan-two: WRONG ACCOUNT — live, but NOT the account enrolled for this store on ${ENROLLED_AT} ` +
        "(enrolled as two@acme.example) — a sign-in replaced it; `slopweaver claude signin` walks the repair",
    ]);
  });

  it("names DUPLICATE on both stores when two live stores name one organisation — the incident", () => {
    const alarms = watchIdentityAlarms({
      accounts: ACCOUNTS,
      assertions: ASSERTIONS,
      probes: [
        live({ alias: "plan-one", organizationId: "org-FIXTURE-one" }),
        live({ alias: "plan-two", organizationId: "org-FIXTURE-one" }),
      ],
    });

    const duplicate =
      ": DUPLICATE — live, but another store holds this same account — two slots cannot share one plan; " +
      "`slopweaver claude signin` walks the repair";
    expect(alarms).toEqual([`plan-one${duplicate}`, `plan-two${duplicate}`]);
  });

  it("names WRONG ACCOUNT, not DUPLICATE, when a probed store takes the account of one the watch never probes", () => {
    // plan-two is paused or monthly, so it is not in the tick's fleet: the collision is invisible, the change is not.
    const alarms = watchIdentityAlarms({
      accounts: [account({ alias: "plan-one" })],
      assertions: ASSERTIONS,
      probes: [live({ alias: "plan-one", organizationId: "org-FIXTURE-two" })],
    });

    expect(alarms).toEqual([
      `plan-one: WRONG ACCOUNT — live, but NOT the account enrolled for this store on ${ENROLLED_AT} ` +
        "— a sign-in replaced it; `slopweaver claude signin` walks the repair",
    ]);
  });

  it("never prints an organisation id, whichever alarm fires", () => {
    const alarms = watchIdentityAlarms({
      accounts: [...ACCOUNTS, account({ alias: "plan-three" })],
      assertions: [...ASSERTIONS, assertion({ alias: "plan-three", organizationId: "org-FIXTURE-three" })],
      probes: [
        live({ alias: "plan-one", organizationId: "org-FIXTURE-two" }),
        live({ alias: "plan-two", organizationId: "org-FIXTURE-two" }),
        live({ alias: "plan-three", organizationId: "org-FIXTURE-other" }),
      ],
    });

    expect(alarms.length).toBe(3);
    expect(alarms.join("\n")).not.toContain("org-FIXTURE");
  });

  it("masks an organisation id that reaches an alarm through an enrollment's free-text address", () => {
    const alarms = watchIdentityAlarms({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", email: "org-FIXTURE-live", organizationId: "org-FIXTURE-one" })],
      probes: [live({ alias: "plan-one", organizationId: "org-FIXTURE-live" })],
    });

    expect(alarms).toEqual([
      `plan-one: WRONG ACCOUNT — live, but NOT the account enrolled for this store on ${ENROLLED_AT} ` +
        "(enrolled as [organisation]) — a sign-in replaced it; `slopweaver claude signin` walks the repair",
    ]);
  });

  it("masks a longer id whole when a shorter held id is a substring of it", () => {
    const alarms = watchIdentityAlarms({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", email: "org-FIXTURE-live", organizationId: "org-FIXTURE-live" })],
      probes: [live({ alias: "plan-one", organizationId: "org-FIXTURE" })],
    });

    expect(alarms).toEqual([
      `plan-one: WRONG ACCOUNT — live, but NOT the account enrolled for this store on ${ENROLLED_AT} ` +
        "(enrolled as [organisation]) — a sign-in replaced it; `slopweaver claude signin` walks the repair",
    ]);
  });

  it("never re-masks inside a placeholder it already wrote", () => {
    const alarms = watchIdentityAlarms({
      accounts: [account({ alias: "plan-one" })],
      assertions: [assertion({ alias: "plan-one", email: "enrolled-org", organizationId: "enrolled-org" })],
      probes: [live({ alias: "plan-one", organizationId: "org" })],
    });

    expect(alarms).toEqual([
      `plan-one: WRONG ACCOUNT — live, but NOT the account enrolled for this store on ${ENROLLED_AT} ` +
        "(enrolled as [organisation]) — a sign-in replaced it; `slopweaver claude signin` walks the repair",
    ]);
  });

  it("leaves the alias and the repair command whole when an id matches their text", () => {
    const alarms = watchIdentityAlarms({
      accounts: [account({ alias: "signin" })],
      assertions: [assertion({ alias: "signin", organizationId: "signin" })],
      probes: [live({ alias: "signin", organizationId: "org-FIXTURE-other" })],
    });

    expect(alarms).toEqual([
      `signin: WRONG ACCOUNT — live, but NOT the account enrolled for this store on ${ENROLLED_AT} ` +
        "— a sign-in replaced it; `slopweaver claude signin` walks the repair",
    ]);
  });

  it("stays silent on a store it could not read and on one nobody enrolled", () => {
    const alarms = watchIdentityAlarms({
      accounts: [...ACCOUNTS, account({ alias: "plan-three" })],
      assertions: ASSERTIONS,
      probes: [
        { organizationId: "org-FIXTURE-other", outcome: { alias: "plan-one", problem: "the store could not be read" } },
        live({ alias: "plan-two", organizationId: "org-FIXTURE-two" }),
        live({ alias: "plan-three", organizationId: "org-FIXTURE-three" }),
      ],
    });

    expect(alarms).toEqual([]);
  });

  it("prints nothing for an empty fleet", () => {
    expect(watchIdentityAlarms({ accounts: [], assertions: [], probes: [] })).toEqual([]);
  });
});
