/**
 * `readPlanCeilings` over injected reads, and `codexPlanInputsOf`'s mapping of a fleet assessment.
 *
 * The ordering case is the one that matters: a Claude probe left in flight across the synchronous Codex read
 * timed out on every plan, so the witness here is the order the fakes were CALLED and SETTLED in.
 *
 * The account cases hold the Fleet page's hover to `claude gauge`'s rule: an address is the account only when an
 * enrollment bound it to the organisation the probe named, and the organisation id never reaches an input.
 */
import { describe, expect, it } from "vitest";

import {
  type ClaudeCeilingProbe,
  codexPlanInputsOf,
  type PlanCeilingDeps,
  readPlanCeilings,
} from "../../../capacity/readCeilings.js";
import type { ClaudeAccount, ClaudeAccountGauge } from "../../../claude/contracts.js";
import type { ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import { type ClaudeThresholds, DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { PlanAllowance, UsageLimitPercent } from "../../../plans/usageLimit.js";

const NOW = "2026-09-28T09:00:00.000Z";

/** A configured plan, paused when a reason is given, carrying its usage policy when one is given. */
function account({
  alias,
  paused,
  email,
  allowance,
  usageLimitPercent,
}: {
  alias: string;
  paused?: string;
  email?: string;
  allowance?: PlanAllowance;
  usageLimitPercent?: UsageLimitPercent;
}): ClaudeAccount {
  return {
    alias,
    storeDir: `/stores/${alias}`,
    ...(email === undefined ? {} : { email }),
    ...(paused === undefined ? {} : { paused: { reason: paused, sinceIso: NOW } }),
    ...(allowance === undefined ? {} : { allowance }),
    ...(usageLimitPercent === undefined ? {} : { usageLimitPercent }),
  };
}

/** A gauge reading for one plan. */
function gauge({ alias }: { alias: string }): ClaudeAccountGauge {
  const window = { resetAtIso: "2026-09-28T12:00:00.000Z", status: "allowed", utilization: 0.4 } as const;
  return { alias, fiveHour: window, observedAtIso: NOW, sevenDay: window };
}

/** Fake reads that log each call, the probes settling on the next tick. */
function fakeDeps({
  accounts,
  log,
  assertions = [],
  probe = () => ({ kind: "unreadable", problem: "probe request could not be completed" }),
  spend = () => ({ kind: "not-measured", reason: "no spend reading recorded" }),
  before = { kind: "none", why: "no reading of machine capacity" },
  thresholds = DEFAULT_THRESHOLDS.claude,
}: {
  accounts: readonly ClaudeAccount[] | string;
  thresholds?: ClaudeThresholds;
  log: string[];
  assertions?: readonly ClaudeIdentityAssertion[];
  probe?: (args: { alias: string }) => ClaudeCeilingProbe;
  spend?: (args: { alias: string }) => ReturnType<PlanCeilingDeps["claudeSpend"]>;
  before?: ReturnType<PlanCeilingDeps["capacityDocumentAt"]>;
}): PlanCeilingDeps {
  return {
    capacityDocumentAt: ({ asOfIso }) => {
      log.push(`before ${asOfIso}`);
      return before;
    },
    claudeAccounts: async () => {
      if (typeof accounts === "string") {
        return accounts;
      }
      return { accounts, thresholds };
    },
    claudeAssertions: () => {
      log.push("assertions");
      return assertions;
    },
    claudeSpend: ({ account: plan, nowIso }) => {
      log.push(`spend ${plan.alias} at ${nowIso}`);
      return spend({ alias: plan.alias });
    },
    codexFleet: async () => {
      log.push("codex");
      return "no plan register at /home/codex-plans.json";
    },
    probe: async ({ alias }) => {
      log.push(`probe ${alias}`);
      await Promise.resolve();
      log.push(`settled ${alias}`);
      return probe({ alias });
    },
  };
}

describe("readPlanCeilings", () => {
  it("settles every Claude probe BEFORE the synchronous Codex read, and never probes a paused plan", async () => {
    const log: string[] = [];
    const inputs = await readPlanCeilings({
      deps: fakeDeps({
        accounts: [
          account({ alias: "plan-one" }),
          account({ alias: "plan-two", email: "two@example.test", paused: "owner paused it" }),
        ],
        log,
      }),
      home: "/home",
      nowIso: NOW,
    });

    expect(log).toStrictEqual(["assertions", "probe plan-one", `before ${NOW}`, "settled plan-one", "codex"]);
    expect(inputs).toStrictEqual({
      claude: [
        {
          account: "NOT ENROLLED",
          alias: "plan-one",
          kind: "unreadable",
          problem: "probe request could not be completed",
        },
        {
          account: "CACHED two@example.test",
          alias: "plan-two",
          kind: "paused",
          pause: {
            sinceIso: NOW,
            weekAtPause: {
              kind: "unavailable",
              why: "no capacity reading before the pause: no reading of machine capacity",
            },
          },
          reason: "owner paused it",
        },
      ],
      claudeThresholds: DEFAULT_THRESHOLDS.claude,
      codex: [],
      codexRoutedAlias: null,
      problems: ["codex: no plan register at /home/codex-plans.json"],
    });
  });

  it("carries the register's own Claude thresholds through, not the defaults", async () => {
    const custom = { ...DEFAULT_THRESHOLDS.claude, routeAt: 0.8 };
    const inputs = await readPlanCeilings({
      deps: fakeDeps({ accounts: [], log: [], thresholds: custom }),
      home: "/home",
      nowIso: NOW,
    });

    expect(inputs.claudeThresholds.routeAt).toBe(0.8);
  });

  it("calls a probed plan by the enrolled address only when the probe named the enrolled organisation", async () => {
    const assertions: ClaudeIdentityAssertion[] = [
      { alias: "plan-one", assertedAtIso: NOW, email: "one@example.test", organizationId: "org-one" },
      { alias: "plan-two", assertedAtIso: NOW, email: "two@example.test", organizationId: "org-two" },
      { alias: "plan-three", assertedAtIso: NOW, email: "three@example.test", organizationId: "org-three" },
    ];
    const named: Readonly<Record<string, string>> = { "plan-one": "org-one", "plan-two": "org-elsewhere" };
    const inputs = await readPlanCeilings({
      deps: fakeDeps({
        accounts: [
          account({ alias: "plan-one", email: "stale@example.test" }),
          account({ alias: "plan-two" }),
          account({ alias: "plan-three" }),
        ],
        assertions,
        log: [],
        probe: ({ alias }) => {
          const organization = named[alias];
          return {
            gauge: gauge({ alias }),
            kind: "read",
            ...(organization === undefined ? {} : { observedOrganizationId: organization }),
          };
        },
      }),
      home: "/home",
      nowIso: NOW,
    });

    expect(inputs.claude.map((plan) => plan.account)).toStrictEqual([
      "one@example.test (accounts.json says stale@example.test)",
      "WRONG ACCOUNT",
      "UNREAD",
    ]);
    expect(JSON.stringify(inputs)).not.toContain("org-one");
    expect(JSON.stringify(assertions)).toContain("org-one");
  });

  it("never probes a monthly-spend plan, carrying its spend verdict at the reading's own instant instead", async () => {
    const log: string[] = [];
    const inputs = await readPlanCeilings({
      deps: fakeDeps({
        accounts: [account({ alias: "plan-one", allowance: { kind: "monthly-spend" }, email: "one@example.test" })],
        log,
      }),
      home: "/home",
      nowIso: NOW,
    });

    expect(log).toStrictEqual(["assertions", `spend plan-one at ${NOW}`, "codex"]);
    expect(inputs.claude).toStrictEqual([
      {
        account: "CACHED one@example.test",
        alias: "plan-one",
        kind: "spend",
        verdict: { kind: "not-measured", reason: "no spend reading recorded" },
      },
    ]);
  });

  it("pairs a probed reading with the usage limit set on its plan", async () => {
    const inputs = await readPlanCeilings({
      deps: fakeDeps({
        accounts: [account({ alias: "plan-one", usageLimitPercent: 30 })],
        log: [],
        probe: ({ alias }) => ({ gauge: gauge({ alias }), kind: "read" }),
      }),
      home: "/home",
      nowIso: NOW,
    });

    expect(inputs.claude).toStrictEqual([
      {
        account: "NOT ENROLLED",
        gauge: { ...gauge({ alias: "plan-one" }), allowance: { kind: "weekly-window" }, usageLimitPercent: 30 },
        kind: "read",
      },
    ]);
  });

  it("names an unreadable account list as a Claude problem and still reads Codex", async () => {
    const log: string[] = [];
    const inputs = await readPlanCeilings({
      deps: fakeDeps({ accounts: "accounts.json is not valid JSON", log }),
      home: "/home",
      nowIso: NOW,
    });

    expect(log).toStrictEqual(["codex"]);
    expect(inputs.problems).toStrictEqual([
      "claude: accounts.json is not valid JSON",
      "codex: no plan register at /home/codex-plans.json",
    ]);
  });
});

describe("codexPlanInputsOf", () => {
  it("carries each row's windows, account, free resets, the ranker's exclusion by alias, and the top-ranked destination", () => {
    const mapped = codexPlanInputsOf({
      assessment: {
        ranking: {
          excluded: [{ destination: { alias: "ambient" }, kind: "near-cap", reason: "weekly at 100%" }],
          ranked: [{ alias: "codex-two" }, { alias: "codex-one" }],
        },
        rows: [
          {
            alias: "ambient",
            emailCached: "old@example.test",
            gauge: { windows: [{ label: "weekly", resetAtIso: undefined, usedPercent: 100 }] },
            liveEmail: "new@example.test",
            liveState: "signed-in",
            resetCreditsAvailable: 2,
            usageLimitPercent: 100,
          },
          {
            alias: "codex-one",
            emailCached: "one@example.test",
            gauge: null,
            liveEmail: null,
            liveState: "unreadable",
            resetCreditsAvailable: null,
            usageLimitPercent: 100,
          },
          {
            alias: "codex-two",
            emailCached: null,
            gauge: { windows: [{ label: "weekly", resetAtIso: "2026-10-03T00:00:00.000Z", usedPercent: 95 }] },
            liveEmail: "two@example.test",
            liveState: "signed-in",
            resetCreditsAvailable: 0,
            usageLimitPercent: 40,
          },
        ],
      },
    });

    expect(mapped).toStrictEqual({
      codex: [
        {
          account: "new@example.test (the register says old@example.test)",
          alias: "ambient",
          exclusion: { kind: "near-cap", reason: "weekly at 100%" },
          freeResets: 2,
          usageLimitPercent: 100,
          windows: [{ label: "weekly", resetAtIso: null, usedPercent: 100 }],
        },
        {
          account: "CACHED one@example.test",
          alias: "codex-one",
          exclusion: null,
          freeResets: null,
          usageLimitPercent: 100,
          windows: null,
        },
        {
          account: "two@example.test",
          alias: "codex-two",
          exclusion: null,
          freeResets: 0,
          usageLimitPercent: 40,
          windows: [{ label: "weekly", resetAtIso: "2026-10-03T00:00:00.000Z", usedPercent: 95 }],
        },
      ],
      codexRoutedAlias: "codex-two",
    });
  });
});
