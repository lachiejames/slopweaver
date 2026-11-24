/**
 * The chair's hand-off cadence as a decision table — each measured reason at its boundary, what may not decide,
 * and the exact block a chair reads. The chair (plan-five at its wall, Claude Code 2.1.280 beside a
 * 2.1.283 boot) is the first row; the stale-canon rows hold the rule that a stale canon must not linger for days to both
 * of its halves.
 */
import { describe, expect, it } from "vitest";

import { chairPlanVerdict } from "../../../claude/seatBoot.js";
import { type ChairCadenceGauge, chairCadenceSessions, judgeChairCadence } from "../../../supervisor/chairCadence.js";
import { chairCadenceLines } from "../../../supervisor/chairCadenceLines.js";
import type { ChairRead } from "../../../supervisor/chairGate.js";

import { atDefaultBars, behindOne, CURRENT, FRESH, gauge, handOffOf, NOW, session } from "./chairCadenceFixture.js";

/** One canon commit landed on main after every boot these cases use. */
const CANON_COMMIT = {
  committedIso: "2026-10-01T09:00:00Z",
  sha: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443",
  subject: "A background bash is stopped at its timeout (#1659)",
} as const;

describe("judgeChairCadence", () => {
  it("hands the plan-five chair off for all three reasons at once, naming the route's plan", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({
        nextChair: "plan-three",
        plans: [
          ["plan-five", 100, 95],
          ["plan-three", 40, 10],
        ],
      }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-five", version: "2.1.280" })],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [
        atDefaultBars.near({ alias: "plan-five", pct: 100, window: "seven-day" }),
        atDefaultBars.near({ alias: "plan-five", pct: 95, window: "seven-day Fable" }),
        atDefaultBars.asymmetric({ alias: "plan-five", fablePct: 95, routeAlias: "plan-three", routeFablePct: 10 }),
        { boots: "2.1.283", kind: "claude-code-behind", running: "2.1.280" },
      ],
      route: { alias: "plan-three", kind: "picks" },
    });
  });

  it("names a chair with no readable session UNMEASURED rather than a silent stay", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-three", plans: [["plan-three", 40, 10]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [],
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: ["no Claude session was read in the chair workspace, so its plan and Claude Code are UNMEASURED"],
    });
  });

  it("stays at 74% and hands off at 75% of the plan-wide week", () => {
    const at = ({ weekPct }: { weekPct: number }) =>
      judgeChairCadence({
        boots: CURRENT,
        gauge: gauge({
          nextChair: "plan-two",
          plans: [
            ["plan-one", weekPct, 20],
            ["plan-two", 20, 10],
          ],
        }),
        newestInstalled: CURRENT,
        nowIso: NOW,
        sessions: [session({ plan: "plan-one", version: "2.1.283" })],
      }).kind;

    expect(at({ weekPct: 74 })).toBe("stay");
    expect(at({ weekPct: 75 })).toBe("hand-off");
  });

  it("hands off at 75% of the Fable week alone", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({
        nextChair: "plan-two",
        plans: [
          ["plan-one", 30, 75],
          ["plan-two", 30, 65],
        ],
      }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [atDefaultBars.near({ alias: "plan-one", pct: 75, window: "seven-day Fable" })],
      route: { alias: "plan-two", kind: "picks" },
    });
  });

  it("stays on handoff-9297's plan-five at 76% of its week while the Fable route still picks plan-five, and hands off once it moves", () => {
    // ~/.slopweaver/supervisor-scratch/handoff-<n>/tick-1/gauge.txt:`next fable spawn -> plan-five`.
    const plans = [
      ["plan-one", 53, 100],
      ["plan-two", 21, 6],
      ["plan-three", 60, 71],
      ["plan-four", 18, 0],
      ["plan-five", 76, 57],
    ] as const;
    const routedTo = ({ nextChair }: { nextChair: string }) =>
      judgeChairCadence({
        boots: CURRENT,
        gauge: gauge({ nextChair, plans }),
        newestInstalled: CURRENT,
        nowIso: NOW,
        sessions: [session({ plan: "plan-five", version: "2.1.283" })],
      });

    expect(routedTo({ nextChair: "plan-five" })).toStrictEqual({
      kind: "stay",
      notes: [
        "plan-five is at 76% of its seven-day week, but the chair's successor routes to plan-five too, so a successor would land on the same plan — not a reason to hand off until routing moves off it",
      ],
    });
    expect(routedTo({ nextChair: "plan-four" })).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [
        atDefaultBars.near({ alias: "plan-five", pct: 76, window: "seven-day" }),
        atDefaultBars.asymmetric({ alias: "plan-five", fablePct: 57, routeAlias: "plan-four", routeFablePct: 0 }),
      ],
      route: { alias: "plan-four", kind: "picks" },
    });
  });

  it("still hands off on the route's own plan for a reason a fresh boot fixes anywhere", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-five", plans: [["plan-five", 76, 57]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-five", version: "2.1.280" })],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: [
        "plan-five is at 76% of its seven-day week, but the chair's successor routes to plan-five too, so a successor would land on the same plan — not a reason to hand off until routing moves off it",
      ],
      reasons: [{ boots: "2.1.283", kind: "claude-code-behind", running: "2.1.280" }],
      route: { alias: "plan-five", kind: "picks" },
    });
  });

  it("stays at exactly 15 Fable points ahead of the route's plan, and hands off at 16", () => {
    const at = ({ fablePct }: { fablePct: number }) =>
      judgeChairCadence({
        boots: CURRENT,
        gauge: gauge({
          nextChair: "plan-two",
          plans: [
            ["plan-one", 30, fablePct],
            ["plan-two", 30, 10],
          ],
        }),
        newestInstalled: CURRENT,
        nowIso: NOW,
        sessions: [session({ plan: "plan-one", version: "2.1.283" })],
      }).kind;

    expect(at({ fablePct: 25 })).toBe("stay");
    expect(at({ fablePct: 26 })).toBe("hand-off");
  });

  it("never calls the chair asymmetric against its own plan, or with no route to compare against", () => {
    const own = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 30, 60]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.283" })],
    });
    const none = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({
        nextChair: null,
        plans: [
          ["plan-one", 30, 60],
          ["plan-two", 30, 5],
        ],
      }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.283" })],
    });

    expect(own).toStrictEqual({ kind: "stay", notes: [] });
    expect(none).toStrictEqual({
      kind: "stay",
      notes: ["no plan is eligible for a Fable spawn this tick, so the drift band had nothing to compare against"],
    });
  });

  it("hands off on version drift alone when the plan cannot be named, saying which half was unmeasured", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: { kind: "unmeasured", why: "no gauge capture" },
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [
        {
          ...session({ plan: "plan-one", version: "2.1.280" }),
          plan: { kind: "unresolved", why: "its environment was not read: `ps` could not read it" },
          sessionId: "s1",
        },
      ],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: [
        "the plan gauge is UNMEASURED this tick — no gauge capture",
        "session s1: its plan is UNMEASURED — its environment was not read: `ps` could not read it",
      ],
      reasons: [{ boots: "2.1.283", kind: "claude-code-behind", running: "2.1.280" }],
      route: { kind: "unmeasured" },
    });
  });

  it("stays on an equal or newer running version, and never judges one a fresh boot could not measure", () => {
    const run = ({ version, boots }: { version: string; boots: Parameters<typeof judgeChairCadence>[0]["boots"] }) =>
      judgeChairCadence({
        boots,
        gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
        newestInstalled: CURRENT,
        nowIso: NOW,
        sessions: [session({ plan: "plan-one", version })],
      });

    expect(run({ boots: CURRENT, version: "2.1.283" }).kind).toBe("stay");
    expect(run({ boots: CURRENT, version: "2.1.284" }).kind).toBe("stay");
    expect(run({ boots: { kind: "unmeasured", why: "timed out" }, version: "2.1.280" })).toStrictEqual({
      kind: "stay",
      notes: ["the Claude Code a fresh boot runs is UNMEASURED — timed out"],
    });
  });

  it("notes a newer install a fresh boot would not select, rather than promising a hand-off fixes it", () => {
    const verdict = judgeChairCadence({
      boots: { kind: "measured", version: "2.1.282" },
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.282" })],
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: [
        "Claude Code 2.1.283 is installed but a fresh `claude` boots 2.1.282, so a successor would not run it either",
      ],
    });
  });

  it("names a reason once when two tabs on one plan both carry it", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({
        nextChair: "plan-two",
        plans: [
          ["plan-one", 80, 10],
          ["plan-two", 20, 10],
        ],
      }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.283" }), session({ plan: "plan-one", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [{ alias: "plan-one", kind: "plan-window-near", pct: 80, thresholdPercent: 75, window: "seven-day" }],
      route: { alias: "plan-two", kind: "picks" },
    });
  });

  it("names the routed plan UNMEASURED when it has no row, rather than reading the gap as a stay", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-two", plans: [["plan-one", 30, 90]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: ["the routed plan plan-two's Fable week is UNMEASURED — it has no complete reading in this tick's gauge"],
      reasons: [atDefaultBars.near({ alias: "plan-one", pct: 90, window: "seven-day Fable" })],
      route: { alias: "plan-two", kind: "picks" },
    });
  });

  it("never claims a route off a PARTIAL gauge, in the drift band or the route line", () => {
    const partial: ChairCadenceGauge = gauge({
      gap: "plan-two timed out",
      nextChair: "plan-three",
      plans: [
        ["plan-five", 40, 40],
        ["plan-three", 10, 10],
      ],
    });
    const stays = judgeChairCadence({
      boots: CURRENT,
      gauge: partial,
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-five", version: "2.1.283" })],
    });
    const behind = judgeChairCadence({
      boots: CURRENT,
      gauge: partial,
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-five", version: "2.1.280" })],
    });

    expect(stays).toStrictEqual({
      kind: "stay",
      notes: [
        "the plan gauge is PARTIAL this tick, so a plan it missed is UNMEASURED — plan-two timed out",
        "the drift band is UNMEASURED — a PARTIAL gauge cannot say which plan routing picks",
      ],
    });
    expect(behind).toMatchObject({ kind: "hand-off", route: { kind: "unmeasured" } });
    expect(chairCadenceLines({ target: { kind: "claude" }, verdict: handOffOf({ verdict: behind }) })[2]!).toBe(
      "  which plan routing picks is UNMEASURED this tick — `slopweaver claude route --model fable` names it; the successor boots the current Claude Code on whatever plan routing picks.",
    );
  });

  it("hands off on a row a PARTIAL gauge carries, which is complete, while the route stays UNMEASURED", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({
        gap: "plan-two was not read: timed out",
        nextChair: "plan-three",
        plans: [
          ["plan-one", 80, 10],
          ["plan-three", 10, 10],
        ],
      }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: [
        "the plan gauge is PARTIAL this tick, so a plan it missed is UNMEASURED — plan-two was not read: timed out",
        "the drift band is UNMEASURED — a PARTIAL gauge cannot say which plan routing picks",
      ],
      reasons: [{ alias: "plan-one", kind: "plan-window-near", pct: 80, thresholdPercent: 75, window: "seven-day" }],
      route: { kind: "unmeasured" },
    });
  });

  it("says the newest install is UNMEASURED rather than staying silently", () => {
    const verdict = judgeChairCadence({
      boots: { kind: "measured", version: "2.1.282" },
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
      newestInstalled: { kind: "unmeasured", why: "Claude Code's versions directory holds no version" },
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.282" })],
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: ["the newest Claude Code installed is UNMEASURED — Claude Code's versions directory holds no version"],
    });
  });

  it("stays at 35h and hands off at 36h on canon main changed since boot, naming the newest commit", () => {
    const booted = ({ bootedIso }: { bootedIso: string }) =>
      judgeChairCadence({
        boots: CURRENT,
        gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
        newestInstalled: CURRENT,
        nowIso: NOW,
        sessions: [
          session({
            canon: { bootedIso, changed: [CANON_COMMIT], kind: "measured" },
            plan: "plan-one",
            version: "2.1.283",
          }),
        ],
      });

    expect(booted({ bootedIso: "2026-09-30T00:00:01.000Z" }).kind).toBe("stay");
    expect(booted({ bootedIso: "2026-09-30T00:00:00.000Z" })).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [
        {
          ageHours: 36,
          bootedIso: "2026-09-30T00:00:00.000Z",
          commits: 1,
          kind: "canon-stale",
          newestSha: "34e48e7b7",
          newestSubject: "A background bash is stopped at its timeout (#1659)",
        },
      ],
      route: { alias: "plan-one", kind: "picks" },
    });
  });

  it("never hands off on age alone: a five-day chair whose canon main left alone stays", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [
        session({
          canon: { bootedIso: "2026-09-26T12:00:00.000Z", changed: [], kind: "measured" },
          plan: "plan-one",
          version: "2.1.283",
        }),
      ],
    });

    expect(verdict).toStrictEqual({ kind: "stay", notes: [] });
  });

  it("never hands off a fresh successor on canon changed since its boot", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ canon: { ...FRESH, changed: [CANON_COMMIT] }, plan: "plan-one", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({ kind: "stay", notes: [] });
  });

  it("never reads an unparseable tick instant as stale, where NaN would compare false against the threshold", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
      newestInstalled: CURRENT,
      nowIso: "not-an-instant",
      sessions: [session({ canon: { ...FRESH, changed: [CANON_COMMIT] }, plan: "plan-one", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: [
        "session a0000032: its age is UNMEASURED — not-an-instant or its boot 2026-10-01T11:00:00.000Z is not an instant",
      ],
    });
  });

  it("names a boot or canon read it could not make UNMEASURED, deciding nothing", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [
        session({
          canon: {
            kind: "unmeasured",
            why: "its session registry file records no `startedAt`, so its boot is unknown",
          },
          plan: "plan-one",
          version: "2.1.283",
        }),
      ],
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: [
        "session a0000032: whether its loaded canon is stale is UNMEASURED — its session registry file records no `startedAt`, so its boot is unknown",
      ],
    });
  });

  it("hands off a chair whose plan has no row while a DIFFERENT measured plan is the Fable route — plan-five", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-five", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: ["plan-five's budget is UNMEASURED — it has no complete reading in this tick's gauge"],
      reasons: [{ alias: "plan-five", kind: "plan-unmeasured", routeAlias: "plan-one" }],
      route: { alias: "plan-one", kind: "picks" },
    });
  });
});

describe("chairCadenceLines", () => {
  it("prints the hand-off block a chair acts on before it re-arms", () => {
    const lines = chairCadenceLines({
      target: { kind: "claude" },
      verdict: {
        kind: "hand-off",
        notes: ["session s2: its plan is UNMEASURED — no api_request telemetry was found for its recent prompts"],
        reasons: [
          atDefaultBars.near({ alias: "plan-five", pct: 100, window: "seven-day" }),
          atDefaultBars.asymmetric({ alias: "plan-five", fablePct: 95, routeAlias: "plan-three", routeFablePct: 10 }),
          { boots: "2.1.283", kind: "claude-code-behind", running: "2.1.280" },
        ],
        route: { alias: "plan-three", kind: "picks" },
      },
    });

    expect(lines).toStrictEqual([
      "HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
      "  - plan-five is at 100% of its seven-day week — at or past 75%, so leave it before the wall",
      "  - plan-five is at 95% Fable while plan-three is at 10% — 85 points apart, past the 15-point band",
      "  - this chair runs Claude Code 2.1.280; a fresh boot runs 2.1.283",
      "  route currently picks plan-three for a Fable spawn; the successor boots the current Claude Code on whatever plan routing picks.",
      "  Record this tick, write the handoff, then `slopweaver cmux spawn <handoff slug> --driver claude --model fable` and let the successor take the pin and re-arm the sweep — do NOT re-arm from this chair.",
      "chair cadence: session s2: its plan is UNMEASURED — no api_request telemetry was found for its recent prompts",
    ]);
  });

  it("prints the stale-canon reason with its boot, its age, the canon paths and the newest commit", () => {
    const lines = chairCadenceLines({
      target: { kind: "claude" },
      verdict: {
        kind: "hand-off",
        notes: [],
        reasons: [
          {
            ageHours: 40,
            bootedIso: "2026-09-30T09:43:05.000Z",
            commits: 12,
            kind: "canon-stale",
            newestSha: "34e48e7b7",
            newestSubject: "A background bash is stopped at its timeout (#1659)",
          },
        ],
        route: { alias: "plan-two", kind: "picks" },
      },
    });

    expect(lines[1]!).toBe(
      '  - this chair booted 2026-09-30T09:43:05.000Z, 40h ago — at or past 36h — and origin/main has since changed its loaded canon (skills/supervisor, .claude/rules, AGENTS.md) in 12 commit(s), newest 34e48e7b7 "A background bash is stopped at its timeout (#1659)"',
    );
  });

  it("prints only the notes when the chair stays", () => {
    expect(
      chairCadenceLines({ verdict: { kind: "stay", notes: ["the plan gauge is UNMEASURED this tick — x"] } }),
    ).toStrictEqual(["chair cadence: the plan gauge is UNMEASURED this tick — x"]);
  });

  it("says routing names no plan when no plan can take a Fable spawn", () => {
    const lines = chairCadenceLines({
      target: { kind: "claude" },
      verdict: behindOne({ route: { kind: "none" } }),
    });

    expect(lines[2]!).toBe(
      "  routing names no plan that can take a Fable spawn right now — `slopweaver claude route --model fable` says why; the successor boots the current Claude Code on whatever plan routing picks.",
    );
  });
});

describe("chairCadenceSessions", () => {
  const chair: ChairRead = {
    kind: "resolved",
    sessions: [
      { pid: 1, sessionId: "s1", verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } },
      { pid: 2, sessionId: "s2", verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } },
    ],
    workspaceCwd: "/wt/chair",
    workspaceId: "WS",
  };
  /** No session's transcript, boot or auto-compactions read. */
  const nothingRead = { autoCompactions: new Map(), canon: new Map(), versions: new Map() };

  it("keeps every chair session, joined by id, reading UNMEASURED where the boot read or the transcript said nothing", () => {
    // Boot rows arrive in the other order, and name no s2: the join is by process and session id, and s2 stays in the chair.
    const plans = chairPlanVerdict({
      sessions: [
        { pid: 3, plan: { alias: "plan-two", kind: "store" }, sessionId: "s3" },
        { pid: 1, plan: { alias: "plan-one", kind: "token" }, sessionId: "s1" },
      ],
    });

    expect(
      chairCadenceSessions({
        autoCompactions: new Map([["s1", { autoCompactions: 2, kind: "below-trial" } as const]]),
        canon: new Map([["s1", FRESH]]),
        chair,
        plans,
        versions: new Map([["s1", { kind: "measured", version: "2.1.280" } as const]]),
      }),
    ).toStrictEqual([
      {
        autoCompactions: { autoCompactions: 2, kind: "below-trial" },
        canon: FRESH,
        claudeCode: { kind: "measured", version: "2.1.280" },
        pid: 1,
        plan: { alias: "plan-one", kind: "token" },
        sessionId: "s1",
      },
      {
        autoCompactions: { kind: "unmeasured", why: "its transcript was not read" },
        canon: { kind: "unmeasured", why: "its boot was not read" },
        claudeCode: { kind: "unmeasured", why: "its transcript was not read" },
        pid: 2,
        plan: { kind: "unresolved", why: "the boot-credential read named no plan for this session" },
        sessionId: "s2",
      },
    ]);
  });

  it("keeps each process's own boot plan when two live processes resume one session id", () => {
    const shared = { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } as const;
    const plans = chairPlanVerdict({
      sessions: [
        { pid: 101, plan: { alias: "plan-one", kind: "token" }, sessionId: "same" },
        { pid: 202, plan: { alias: "plan-five", kind: "token" }, sessionId: "same" },
      ],
    });

    const rows = chairCadenceSessions({
      chair: {
        kind: "resolved",
        sessions: [
          { pid: 202, sessionId: "same", verdict: shared },
          { pid: 101, sessionId: "same", verdict: shared },
        ],
        workspaceCwd: "/wt/chair",
        workspaceId: "WS",
      },
      plans,
      ...nothingRead,
    });

    expect(rows.map(({ pid, plan }) => ({ pid, plan }))).toStrictEqual([
      { pid: 202, plan: { alias: "plan-five", kind: "token" } },
      { pid: 101, plan: { alias: "plan-one", kind: "token" } },
    ]);
  });

  it("judges two tabs on two boot plans each on its own, never off the gauge's unanimous mark", () => {
    const plans = chairPlanVerdict({
      sessions: [
        { pid: 1, plan: { alias: "plan-five", kind: "token" }, sessionId: "s1" },
        { pid: 2, plan: { alias: "plan-one", kind: "store" }, sessionId: "s2" },
      ],
    });
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({
        nextChair: "plan-one",
        plans: [
          ["plan-five", 100, 20],
          ["plan-one", 20, 10],
        ],
      }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: chairCadenceSessions({ ...nothingRead, chair, plans }),
    });

    expect(plans.active).toBeUndefined();
    expect(verdict.kind).toBe("hand-off");
    expect((verdict as { reasons: unknown }).reasons).toStrictEqual([
      { alias: "plan-five", kind: "plan-window-near", pct: 100, thresholdPercent: 75, window: "seven-day" },
    ]);
  });

  it("carries a matched session's unresolved boot read, and a wholly unread chair's reason, as they were", () => {
    const matched = chairCadenceSessions({
      chair,
      plans: chairPlanVerdict({
        sessions: [
          {
            pid: 1,
            plan: { kind: "unresolved", why: "it declares a setup token on descriptor 3, but lsof failed" },
            sessionId: "s1",
          },
        ],
      }),
      ...nothingRead,
    });
    const unread = chairCadenceSessions({
      chair,
      plans: chairPlanVerdict({ sessions: [], unread: "the plan register could not be read: bad row" }),
      ...nothingRead,
    });

    expect(matched[0]!.plan).toStrictEqual({
      kind: "unresolved",
      why: "it declares a setup token on descriptor 3, but lsof failed",
    });
    expect(unread.map((row) => row.plan)).toStrictEqual([
      { kind: "unresolved", why: "the plan register could not be read: bad row" },
      { kind: "unresolved", why: "the plan register could not be read: bad row" },
    ]);
  });

  it("has no session for a chair that could not be read", () => {
    expect(
      chairCadenceSessions({
        chair: { cause: "no-chair", kind: "unresolved", why: "no pin" },
        plans: chairPlanVerdict({ sessions: [], unread: "no pin" }),
        ...nothingRead,
      }),
    ).toStrictEqual([]);
  });
});
