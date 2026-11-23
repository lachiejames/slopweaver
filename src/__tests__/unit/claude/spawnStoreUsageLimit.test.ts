import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { gateSpawnStore } from "../../../claude/spawnStore.js";
import { recordClaudeSpendReading } from "../../../claude/spendStore.js";
import {
  cleanGateHome,
  countingDeps,
  makeGateHome,
  memoryGatePorts,
  NOW,
  offlineDeps,
  SUBSCRIPTION,
  writeAccounts,
} from "./spawnStoreFixtures.js";

afterEach(cleanGateHome);

/**
 * Record one monthly-spend plan's spend reading in a gate home, observed inside the hour before the fixtures' own
 * now, so it is fresh. The ledger keeps one reading per instant, so two plans' readings take two instants.
 *
 * @param dir the gate home
 * @param alias the plan
 * @param observedAtIso when it was read, inside the hour before {@link NOW}
 * @param usedMinor what it has spent, of a 50000 monthly limit
 */
function recordSpend({
  alias,
  dir,
  observedAtIso = NOW,
  usedMinor,
}: {
  alias: string;
  dir: string;
  observedAtIso?: string;
  usedMinor: number;
}): void {
  unwrap(
    recordClaudeSpendReading({
      home: dir,
      nowIso: observedAtIso,
      reading: {
        alias,
        currency: "USD",
        decimalPlaces: 2,
        isEnabled: true,
        monthlyLimitMinor: 50_000,
        observedAtIso,
        spendLimitReached: false,
        usedMinor,
      },
    }),
  );
}

/**
 * The owner's own usage limit and a monthly-spend plan are LOCAL POLICY, not provider evidence, so no hatch crosses
 * either: `force` stands in for `SLOPWEAVER_ALLOW_SPENT_PLAN` (the caller ORs the variable into it), and
 * `unreadableHatchOpen` for `SLOPWEAVER_ALLOW_UNREADABLE_PLAN`. Every refusal case below opens BOTH.
 */
describe("gateSpawnStore never crosses the usage limit the owner sets, nor boots a monthly-spend plan", () => {
  const BOTH_AT_THIRTY = JSON.stringify([
    { alias: "plan-one", storeDir: "/stores/plan-one", usageLimitPercent: 30 },
    { alias: "plan-two", storeDir: "/stores/plan-two", usageLimitPercent: 30 },
  ]);
  const BOTH_MONTHLY = JSON.stringify([
    { alias: "plan-one", allowance: { kind: "monthly-spend" }, storeDir: "/stores/plan-one" },
    { alias: "plan-two", allowance: { kind: "monthly-spend" }, storeDir: "/stores/plan-two" },
  ]);
  const ONE_MONTHLY = JSON.stringify([
    { alias: "plan-one", allowance: { kind: "monthly-spend" }, storeDir: "/stores/plan-one" },
    { alias: "plan-two", storeDir: "/stores/plan-two" },
  ]);

  it("refuses a fleet at its usage limit as usage-limit, with no store to release onto, under force and both hatches", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: BOTH_AT_THIRTY });
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => undefined }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: true,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    expect(gated.refusalKind).toBe("usage-limit");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusal).toContain("no `--force` and no escape hatch crosses it");
    expect(gated.refusal).toContain(
      "slopweaver plans set-usage-limit --provider claude --plan plan-one --percent <N> --allowance weekly-window",
    );
  });

  it("refuses a fleet of monthly-spend plans with no spend reading as not-measured, probing none, under force and both hatches", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: BOTH_MONTHLY });
    let probes = 0;
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: true,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    expect(probes).toBe(0);
    expect(gated.refusalKind).toBe("not-measured");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusal).toContain("record a fresh spend reading with `slopweaver claude spend --plan plan-one`");
  });

  it("routes a fleet of monthly-spend plans to the one with the least of its permitted spend used, probing none", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: BOTH_MONTHLY });
    recordSpend({ alias: "plan-one", dir, observedAtIso: "2026-09-12T05:50:00.000Z", usedMinor: 30_000 });
    recordSpend({ alias: "plan-two", dir, observedAtIso: "2026-09-12T05:55:00.000Z", usedMinor: 10_000 });
    let probes = 0;
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: false,
      },
      force: false,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    expect(probes).toBe(0);
    expect(gated.refusal).toBe(undefined);
    expect(gated.storeDir).toBe("/stores/plan-two");
  });

  it("refuses a monthly-spend plan whose spend reached its limit as usage-limit, with the monthly allowance to raise", async () => {
    const dir = makeGateHome();
    writeAccounts({
      dir,
      text: JSON.stringify([
        {
          alias: "plan-one",
          allowance: { kind: "monthly-spend" },
          storeDir: "/stores/plan-one",
          usageLimitPercent: 50,
        },
        {
          alias: "plan-two",
          allowance: { kind: "monthly-spend" },
          storeDir: "/stores/plan-two",
          usageLimitPercent: 50,
        },
      ]),
    });
    recordSpend({ alias: "plan-one", dir, observedAtIso: "2026-09-12T05:50:00.000Z", usedMinor: 25_000 });
    recordSpend({ alias: "plan-two", dir, observedAtIso: "2026-09-12T05:55:00.000Z", usedMinor: 30_000 });
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => undefined }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: true,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    expect(gated.refusalKind).toBe("usage-limit");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusal).toContain(
      "slopweaver plans set-usage-limit --provider claude --plan plan-one --percent <N> --allowance monthly-spend",
    );
  });

  it("routes past a monthly-spend plan to a measured one, probing only the measured one", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: ONE_MONTHLY });
    let probes = 0;
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: false,
      },
      force: false,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    expect(probes).toBe(1);
    expect(gated.refusal).toBe(undefined);
    expect(gated.storeDir).toBe("/stores/plan-two");
  });

  it("never names a monthly-spend plan as the unreadable-plan fallback, even when it is configured first", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: ONE_MONTHLY });
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: false,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    expect(gated.refusal).toBe(undefined);
    expect(gated.storeDir).toBe("/stores/plan-two");
  });

  it("refuses a PINNED monthly-spend seat with no spend reading as not-measured before any probe, and force does not release it", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: ONE_MONTHLY });
    let probes = 0;
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: true,
      model: undefined,
      pinnedStoreDir: "/stores/plan-one",
    });
    expect(probes).toBe(0);
    expect(gated.refusalKind).toBe("not-measured");
    expect(gated.storeDir).toBe("/stores/plan-one");
    expect(gated.refusal).toContain("record a fresh spend reading with `slopweaver claude spend --plan plan-one`");
  });

  it("boots a PINNED monthly-spend seat under its limit on its fresh spend reading, probing nothing", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: ONE_MONTHLY });
    recordSpend({ alias: "plan-one", dir, usedMinor: 10_000 });
    let probes = 0;
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: false,
      },
      force: false,
      model: undefined,
      pinnedStoreDir: "/stores/plan-one",
    });
    expect(probes).toBe(0);
    expect(gated.refusal).toBe(undefined);
    expect(gated.storeDir).toBe("/stores/plan-one");
  });

  it("refuses a PINNED seat at its usage limit as usage-limit, and force does not release it", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: BOTH_AT_THIRTY });
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => undefined }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: true,
      model: undefined,
      pinnedStoreDir: "/stores/plan-one",
    });
    expect(gated.refusalKind).toBe("usage-limit");
    expect(gated.refusal).toContain(
      "claude routing: the pinned seat plan-one has seven_day at 30%, at its usage limit of 30%",
    );
  });

  // With no gauge readable, the unreadable-plan hatch booted the first measurable plan
  // whatever its limit — so a plan already at a 30% limit, whose probe merely failed, was booted past it.
  it("boots NO limited plan blind under the unreadable hatch, refusing as usage-limit when only limited ones remain", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: BOTH_AT_THIRTY });
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: true,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    expect(gated.refusalKind).toBe("usage-limit");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusal).toContain(
      "claude routing: plan-one has a usage limit of 30% and no readable gauge, so nothing shows it is under that limit",
    );
  });

  it("falls back past a limited plan to an unlimited one under the unreadable hatch", async () => {
    const dir = makeGateHome();
    writeAccounts({
      dir,
      text: JSON.stringify([
        { alias: "plan-one", storeDir: "/stores/plan-one", usageLimitPercent: 30 },
        { alias: "plan-two", storeDir: "/stores/plan-two" },
      ]),
    });
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: false,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    expect(gated).toStrictEqual({ basis: "unreadable-override", storeDir: "/stores/plan-two" });
  });

  it("refuses a PINNED limited seat with no readable gauge as usage-limit, even with the unreadable hatch open", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: BOTH_AT_THIRTY });
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: true,
      },
      force: true,
      model: undefined,
      pinnedStoreDir: "/stores/plan-one",
    });
    expect(gated.refusalKind).toBe("usage-limit");
    expect(gated.storeDir).toBe("/stores/plan-one");
    expect(gated.refusal).toContain("claude routing: plan-one has a usage limit of 30% and no readable gauge");
  });
});
