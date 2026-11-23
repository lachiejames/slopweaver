/*
 * Setup's plans reading: `plans list --json` projected into one drop-down per connected plan.
 *
 * The payloads are snapshots typed against the register's own `PlanRegisterSnapshot` and round-tripped through JSON,
 * which is what `plans list --json` prints (`src/cli/commands/plans/run.ts` stringifies the snapshot whole). The site
 * build type-checks this file and cannot resolve what the register's decoder imports, so the decoder's REAL output is
 * fed to this reader from the `src` lane instead (`src/__tests__/unit/plans/planLimitsReaderContract.test.ts`).
 */
import { describe, expect, it } from "vitest";

import type { PlanThresholds } from "../../../src/plans/thresholds";
import type { PlanRegisterSnapshot, RegisteredPlan } from "../../../src/plans/types";
import { PLAN_ALLOWANCE_KINDS, USAGE_LIMIT_PERCENTS } from "../../../src/plans/usageLimit";
import { ALLOWANCE_KINDS, readPlanLimits, USAGE_LIMIT_CHOICES } from "../../components/live/readPlanLimits";
import { actVerbFor, buildActArgv } from "../../lib/actVerbs";
import { liveVerbFor } from "../../lib/liveVerbs";

/**
 * The decoded thresholds every snapshot carries, at the register's defaults. A literal, typed only: the site build
 * cannot resolve the `#lib` import `src/plans/thresholds.ts`'s own `DEFAULT_THRESHOLDS` comes through, and the reader
 * under test never reads this field.
 */
const THRESHOLDS: PlanThresholds = {
  claude: {
    acceptanceAt: 0.9,
    alertAt: 0.75,
    balancedSpread: 0.1,
    driftingSpread: 0.15,
    routeAt: 0.95,
    spendOutAt: 1,
    spendOutBeforeResetMs: 18_000_000,
  },
  codex: { alertAtPercent: 75, pauseAtPercent: 99 },
};

/** What the verb prints for a snapshot: the snapshot, stringified whole. */
const printed = ({ snapshot }: { snapshot: PlanRegisterSnapshot }): unknown => JSON.parse(JSON.stringify(snapshot));

/** A snapshot of a register written down, over these plans. */
const registered = ({ plans }: { plans: readonly RegisteredPlan[] }): PlanRegisterSnapshot => ({
  diagnostics: [],
  document: { rows: [], version: 1 },
  plans,
  revision: 1,
  source: "registered",
  thresholds: THRESHOLDS,
});

const REGISTERED = registered({
  plans: [
    {
      alias: "plan-one",
      allowance: { kind: "weekly-window" },
      email: "owner@acme.example",
      provider: "claude",
      storeDir: "/acme/claude-one",
      usageLimitPercent: 100,
    },
    {
      alias: "plan-two",
      allowance: { kind: "monthly-spend" },
      provider: "claude",
      storeDir: "/acme/claude-two",
      usageLimitPercent: 50,
    },
    {
      alias: "codex-one",
      allowance: { kind: "weekly-window" },
      provider: "codex",
      storeDir: "/acme/codex-one",
      usageLimitPercent: 30,
    },
  ],
});

/** A register nobody adopted: derived from the ambient Codex home, with the decoder's own diagnostic. */
const DERIVED: PlanRegisterSnapshot = {
  diagnostics: [
    {
      code: "DERIVED_REGISTER",
      message:
        "no plan register has been adopted, so this picture was DERIVED from the existing Claude accounts file and " +
        "the ambient Codex home — `slopweaver plans adopt` writes it down",
    },
  ],
  document: { rows: [], version: 1 },
  plans: [
    {
      alias: "codex-ambient",
      allowance: { kind: "weekly-window" },
      provider: "codex",
      storeDir: "/acme/.codex",
      usageLimitPercent: 100,
    },
  ],
  revision: null,
  source: "derived",
  thresholds: THRESHOLDS,
};

describe("readPlanLimits", () => {
  it("draws one plan per register row, pre-selected at its limit — 100 on a row that names none", () => {
    expect(readPlanLimits(printed({ snapshot: REGISTERED }))).toEqual({
      plans: [
        {
          alias: "plan-one",
          allowance: "weekly-window",
          email: "owner@acme.example",
          percent: 100,
          provider: "claude",
        },
        { alias: "plan-two", allowance: "monthly-spend", email: undefined, percent: 50, provider: "claude" },
        { alias: "codex-one", allowance: "weekly-window", email: undefined, percent: 30, provider: "codex" },
      ],
      unadoptedWhy: undefined,
    });
  });

  it("locks every drop-down on an install that has adopted no register, carrying the verb's own reason", () => {
    const view = readPlanLimits(printed({ snapshot: DERIVED }))!;
    expect(view.plans).toEqual([
      { alias: "codex-ambient", allowance: "weekly-window", email: undefined, percent: 100, provider: "codex" },
    ]);
    expect(view.unadoptedWhy).toContain("slopweaver plans adopt");
  });

  it("draws no drop-down on a register with no plans, rather than refusing the reading", () => {
    const empty = registered({ plans: [] });
    const answered = { code: "NO_PLANS", kind: "expected-empty", why: "slopweaver plans list exited 3" };
    expect([readPlanLimits(printed({ snapshot: empty })), readPlanLimits(answered)]).toEqual([
      { plans: [], unadoptedWhy: undefined },
      { plans: [], unadoptedWhy: undefined },
    ]);
  });

  it("keeps a paused plan's drop-down: a pause takes it out of routing, never out of the register", () => {
    const paused = registered({
      plans: [
        {
          alias: "plan-one",
          allowance: { kind: "weekly-window" },
          paused: { reason: "the subscription lapsed", sinceIso: "2026-11-01T00:00:00.000Z" },
          provider: "claude",
          storeDir: "/acme/claude-one",
          usageLimitPercent: 60,
        },
      ],
    });
    expect(readPlanLimits(printed({ snapshot: paused }))!.plans).toEqual([
      { alias: "plan-one", allowance: "weekly-window", email: undefined, percent: 60, provider: "claude" },
    ]);
  });

  it("refuses the whole reading when one row would draw at a value the verb could not have printed", () => {
    const good = printed({ snapshot: REGISTERED }) as { plans: Record<string, unknown>[] };
    const withRow = (row: Record<string, unknown>): unknown => ({ ...good, plans: [...good.plans, row] });
    const base = { alias: "x", allowance: { kind: "weekly-window" }, provider: "claude", usageLimitPercent: 40 };
    expect(
      [
        withRow({ ...base, usageLimitPercent: 45 }),
        withRow({ ...base, usageLimitPercent: undefined }),
        withRow({ ...base, allowance: { kind: "daily" } }),
        withRow({ ...base, provider: "gemini" }),
        withRow({ ...base, alias: "" }),
        withRow({ ...base, email: 7 }),
        withRow({ ...base, alias: "plan-one" }),
        { ...good, source: "imagined" },
        { ...good, plans: "none" },
        "not a document",
      ].map((payload) => readPlanLimits(payload)),
    ).toEqual(Array.from({ length: 10 }, () => undefined));
  });

  it("refuses a reading whose source and DERIVED_REGISTER diagnostic disagree, or whose diagnostic does not read", () => {
    const derived = printed({ snapshot: DERIVED }) as Record<string, unknown> & { diagnostics: unknown[] };
    const written = printed({ snapshot: REGISTERED }) as Record<string, unknown>;
    expect(
      [
        { ...derived, diagnostics: [] },
        { ...derived, diagnostics: [...derived.diagnostics, ...derived.diagnostics] },
        { ...written, diagnostics: derived.diagnostics },
        { ...written, diagnostics: [{ code: "UNKNOWN_CAPACITY" }] },
        { ...written, diagnostics: "none" },
        { code: "SOMETHING_ELSE", kind: "expected-empty", why: "exited 3" },
      ].map((payload) => readPlanLimits(payload)),
    ).toEqual(Array.from({ length: 6 }, () => undefined));
  });
});

describe("the console's limits and the verb's agree", () => {
  it("on every percent and every allowance kind, in order", () => {
    expect(USAGE_LIMIT_PERCENTS.length).toBe(10);
    expect([...USAGE_LIMIT_CHOICES]).toEqual([...USAGE_LIMIT_PERCENTS]);
    expect([...ALLOWANCE_KINDS]).toEqual([...PLAN_ALLOWANCE_KINDS]);
  });
});

describe("the plans section's rows", () => {
  it("reads the register on the fast lane through the verb's JSON form", () => {
    const row = liveVerbFor({ slug: "plans" })!;
    expect([row.argv, row.format, row.lane, row.stampsItsOwnTime, row.timeoutMs, row.expectedEmpty]).toEqual([
      ["plans", "list", "--json"],
      "json",
      "fast",
      false,
      20_000,
      { code: "NO_PLANS", exitCode: 3 },
    ]);
  });

  it("presses set-usage-limit from the drawn limit with the row's own allowance, and re-reads the register", () => {
    const verb = actVerbFor({ slug: "plans-set-usage-limit" })!;
    const plan = readPlanLimits(printed({ snapshot: REGISTERED }))!.plans[1];
    const built = buildActArgv({
      slots: {
        allowance: plan.allowance,
        from: String(plan.percent),
        percent: "70",
        plan: plan.alias,
        provider: plan.provider,
      },
      verb,
    });
    expect([built, verb.readsSlug, verb.timeoutMs]).toEqual([
      {
        argv: [
          "plans",
          "set-usage-limit",
          "--provider",
          "claude",
          "--plan",
          "plan-two",
          "--percent",
          "70",
          "--from",
          "50",
          "--allowance",
          "monthly-spend",
          "--json",
        ],
        kind: "argv",
      },
      "plans",
      20_000,
    ]);
  });
});
