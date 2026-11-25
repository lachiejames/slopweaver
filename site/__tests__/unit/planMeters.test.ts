/*
 * The Fleet page's plan usage block: each host's line (the week left on average, the sessions running, the burn), and
 * what a reading that carried none of it says. One plan's row is `./planMetersRow.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { GlancePlan, GlancePlans } from "../../lib/fleetGlancePlans";
import { type FleetBurn, fleetUsageOf, type UsageRead } from "../../lib/planMeters";
import { CODEX_MONTHLY_SPEND_NOT_MEASURED } from "../../lib/planUsageLimit";
import {
  BURN,
  CLAUDE,
  CLAUDE_TWO,
  CODEX,
  inHand,
  NOW,
  PAUSED,
  read,
  said,
  seat,
  usage,
  window,
} from "./planMetersFixture";

describe("fleetUsageOf, each host's line", () => {
  it("averages the week left across the host's plans, unweighted, and keeps Claude and Codex apart", () => {
    const [claude, codex] = usage({ plans: [CLAUDE, CODEX, CLAUDE_TWO] }).hosts;
    expect([claude.name, claude.remainingPercent, claude.average]).toEqual([
      "Claude",
      31.5,
      said({ text: "32% of the week left on average across 2 plans" }),
    ]);
    expect([codex.name, codex.remainingPercent, codex.average]).toEqual([
      "Codex",
      60,
      said({ text: "60% of the week left on average across 1 plan" }),
    ]);
  });

  it("marks the whole average stale when one plan's reading carried no week, naming that plan by its alias", () => {
    const noWeek = { ...CLAUDE_TWO, windows: [window({ key: "five-hour", used: 10 })] };
    const [claude] = usage({ plans: [CLAUDE, noWeek] }).hosts;
    expect([claude.remainingPercent, claude.average]).toEqual([
      undefined,
      {
        kind: "unread",
        subject: "the Claude plans' average week left",
        why: "plan-two's week did not read this time, so the plans are not averaged",
      },
    ]);
  });

  it("averages over the plans not paused, naming the paused one beside it rather than refusing", () => {
    const [claude] = usage({ plans: [CLAUDE, PAUSED] }).hosts;
    expect([claude.remainingPercent, claude.average]).toEqual([
      44,
      said({ text: "44% of the week left on average across 1 plan · plan-two paused, not counted" }),
    ]);
  });

  it("sets a monthly-spend plan nothing measures aside by name, never refusing the average over it", () => {
    const unmeasured: GlancePlan = {
      ...CLAUDE,
      id: "claude:plan-four",
      reason: CODEX_MONTHLY_SPEND_NOT_MEASURED,
      status: "unreadable",
      windows: [],
    };
    expect([
      usage({ plans: [CLAUDE, PAUSED, unmeasured] }).hosts[0].average,
      usage({ plans: [unmeasured] }).hosts[0].average,
    ]).toEqual([
      said({
        text: "44% of the week left on average across 1 plan · plan-two paused, not counted · plan-four not measured, not counted",
      }),
      said({ text: "no Claude plan is counted · plan-four not measured, not counted" }),
    ]);
  });

  it("sets a Claude monthly-spend plan aside by name, open on its spend window or excluded on its spend reason", () => {
    const open: GlancePlan = {
      ...CLAUDE,
      id: "claude:plan-five",
      windows: [{ available: 100, resetAtIso: undefined, used: 40, window: "monthly-spend" }],
    };
    const unread: GlancePlan = {
      ...CLAUDE,
      id: "claude:plan-six",
      reason: "monthly spend: no spend reading recorded — `slopweaver claude spend --plan plan-six` reads one",
      status: "unreadable",
      windows: [],
    };
    expect([
      usage({ plans: [CLAUDE, open, unread] }).hosts[0].average,
      usage({ plans: [open] }).hosts[0].average,
    ]).toEqual([
      said({
        text: "44% of the week left on average across 1 plan · plan-five, plan-six on monthly spend, not counted",
      }),
      said({ text: "no Claude plan is counted · plan-five on monthly spend, not counted" }),
    ]);
  });

  it("still marks an unread plan beside a paused one, and says so when every plan is paused", () => {
    const noWeek = { ...CLAUDE, windows: [] };
    expect(usage({ plans: [noWeek, PAUSED] }).hosts[0].average).toEqual({
      kind: "unread",
      subject: "the Claude plans' average week left",
      why: "plan-one's week did not read this time, so the plans are not averaged · plan-two paused, not counted",
    });
    expect(usage({ plans: [PAUSED] }).hosts[0].average).toEqual(
      said({ text: "every Claude plan is paused on purpose, so none is counted: plan-two" }),
    );
  });

  it("says a host with no plan in the reading has none, rather than averaging nothing to zero", () => {
    const [, codex] = usage({ plans: [CLAUDE] }).hosts;
    expect([codex.remainingPercent, codex.average, codex.plans]).toEqual([
      undefined,
      said({ text: "no Codex plan in this reading" }),
      { kind: "read", rows: [] },
    ]);
  });

  it("counts Claude's working seats by their host, Codex's sessions off the burn, and an unnamed one on neither", () => {
    const seats = [
      seat({ host: "claude", signal: "working" }),
      seat({ host: "claude", signal: "working" }),
      seat({ host: "claude", signal: "idle" }),
      seat({ host: undefined, signal: "working" }),
    ];
    const block = fleetUsageOf({
      burn: inHand({ value: BURN }),
      nowIso: NOW,
      plans: inHand({ value: read({ plans: [CLAUDE] }) }),
      raiseHeld: undefined,
      seats,
    });
    expect([block.hosts[0].sessions, block.hosts[1].sessions, block.unattributedWords]).toEqual([
      said({ text: "2 sessions working" }),
      said({ text: "4 sessions drawing tokens in the last 10 minutes" }),
      "1 working seat on neither line: its hooks named no host",
    ]);
  });

  it("draws the burn and its seven-day amount for a host measured whole", () => {
    const [claude, codex] = usage({ plans: [CLAUDE] }).hosts;
    expect([claude.burn, codex.burn, claude.burnProblems]).toEqual([
      said({
        text: "2.93B tokens burned in the last 24h · 20.5B over 7 days if the last 24h's usage trend holds, a forecast and not a fact",
      }),
      said({
        text: "311M tokens burned in the last 24h · 2.18B over 7 days if the last 24h's usage trend holds, a forecast and not a fact",
      }),
      [],
    ]);
  });

  it("calls a partial burn a lower bound with no projection, and marks an unavailable one stale", () => {
    const burn: FleetBurn = {
      ...BURN,
      claude: { kind: "unavailable", why: "the projects directory could not be listed" },
      codex: {
        activeSessions: 2,
        kind: "partial",
        outputTokens: 2000,
        problems: ["/r.jsonl: its cumulative token counter fell inside the window"],
        sessions: 3,
        totalTokens: 41_000,
      },
    };
    const [claude, codex] = fleetUsageOf({
      burn: inHand({ value: burn }),
      nowIso: NOW,
      plans: inHand({ value: read({ plans: [] }) }),
      raiseHeld: undefined,
      seats: [],
    }).hosts;
    expect([claude.burn, codex.burn, codex.burnProblems, codex.sessions]).toEqual([
      {
        kind: "unread",
        shortWords: "burn not read",
        subject: "this host's burn in the fleet burn reading",
        why: "the projects directory could not be listed",
      },
      said({ text: "at least 41.0k tokens burned in the last 24h · no projection, 1 reading problem" }),
      ["/r.jsonl: its cumulative token counter fell inside the window"],
      said({ text: "at least 2 sessions drawing tokens in the last 10 minutes" }),
    ]);
  });

  it("spins the burn and Codex's sessions while the burn reading is in flight, and marks them stale when it failed", () => {
    const plans = inHand({ value: read({ plans: [] }) });
    const loading = fleetUsageOf({
      burn: { phase: "loading" },
      nowIso: NOW,
      plans,
      raiseHeld: undefined,
      seats: [],
    }).hosts;
    const failed = fleetUsageOf({
      burn: { phase: "not-measured", why: "exit 1" },
      nowIso: NOW,
      plans,
      raiseHeld: undefined,
      seats: [],
    }).hosts;
    expect([loading[0].burn, loading[1].sessions, failed[0].burn, failed[1].sessions]).toEqual([
      { kind: "reading", subject: "the fleet burn reading" },
      { kind: "reading", subject: "the fleet burn reading" },
      { kind: "unread", shortWords: "burn not read", subject: "the fleet burn reading", why: "exit 1" },
      { kind: "unread", shortWords: "sessions not read", subject: "the fleet burn reading", why: "exit 1" },
    ]);
  });
});

describe("fleetUsageOf, with no plans to draw", () => {
  it("spins both lines while the capacity reading is in flight, and marks why stale for each reading that carried none", () => {
    const reads: readonly UsageRead<GlancePlans>[] = [
      { phase: "loading" },
      { phase: "not-measured", why: "exit 1" },
      inHand({ value: { kind: "absent" } }),
      inHand({ value: { kind: "unreadable" } }),
    ];
    const whys = reads.map((plans) => {
      const block = fleetUsageOf({
        burn: inHand({ value: BURN }),
        nowIso: NOW,
        plans,
        raiseHeld: undefined,
        seats: [],
      });
      return [block.hosts[0].average, block.hosts[1].plans];
    });
    const subject = "the Claude plans' average week left";
    expect(whys).toEqual([
      [{ kind: "reading", subject }, { kind: "reading" }],
      [
        { kind: "unread", subject, why: "the machine capacity reading did not read: exit 1" },
        { kind: "unread", why: "the machine capacity reading did not read: exit 1" },
      ],
      [
        { kind: "unread", subject, why: "the machine capacity reading predates the plans' ceilings" },
        { kind: "unread", why: "the machine capacity reading predates the plans' ceilings" },
      ],
      [
        { kind: "unread", subject, why: "the plans' ceilings in the machine capacity reading did not read" },
        { kind: "unread", why: "the plans' ceilings in the machine capacity reading did not read" },
      ],
    ]);
  });
});
