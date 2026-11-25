/** The chair's hand-off cadence as the recorder prints it, and `cadenceLines` when the chair gate read nothing. */
import { describe, expect, it } from "vitest";

import { chairPlanVerdict } from "../../../../../../claude/seatBoot.js";
import type { ChairGateEvidence } from "../../../../../../cli/commands/supervisor/chairGateRun.js";
import { cadenceLines } from "../../../../../../cli/commands/supervisor/tickRecordCadence.js";
import {
  runSupervisorTickRecord,
  type SupervisorTickRecordDeps,
} from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { ChairAutoCompactionReading } from "../../../../../../supervisor/chairAutoCompaction.js";
import type { CanonCommit } from "../../../../../../supervisor/chairCanon.js";
import { FILL_LANES } from "../../../../plans/laneFixtures.js";
import { allUnavailable, capture, DRAFT, NOT_READ, RECONCILE } from "./harness.js";

describe("the chair's hand-off cadence, as the recorder prints it", () => {
  /** A draft whose gauge read plan-five at its wall and plan-three nearly untouched. */
  const GAUGED = JSON.stringify({
    actions: [],
    handoff: "handoff-9226",
    judgements: [],
    sources: {
      ...allUnavailable(),
      gauge: {
        facts: {
          nextAllModels: "plan-three",
          nextChair: "plan-three",
          nextFable: "plan-three",
          plans: [
            { fablePct: 95, fiveHourPct: 40, plan: "plan-five", resetsIso: "2026-09-27T07:00:00.000Z", weekPct: 100 },
            { fablePct: 10, fiveHourPct: 5, plan: "plan-three", resetsIso: "2026-09-30T07:00:00.000Z", weekPct: 40 },
          ],
          reactNowLines: [],
        },
        observedAtIso: "2026-09-10T12:10:00.000Z",
        status: "read",
        witness: { command: "slopweaver claude gauge --json", exitCode: 0 },
      },
    },
    startedIso: "2026-09-10T12:00:00.000Z",
    tickId: "tick-226-2",
    workspace: "workspace:61",
  });

  /** The chair gate's read of a chair on Fable. Which plan it spends is its boot credential's. */
  const READ_CHAIR: ChairGateEvidence = {
    chair: {
      kind: "resolved",
      sessions: [
        { pid: 38858, sessionId: "a0000032", verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } },
      ],
      directory: "/wt/chair",
      location: { kind: "cmux", workspaceId: "WS" },
    },
    kind: "read",
    lanes: FILL_LANES,
  };

  /** The chair's one session, booted on `alias`'s setup token over descriptor 3. */
  function bootedOn({ alias }: { alias: string }): SupervisorTickRecordDeps["readChairPlans"] {
    return () =>
      Promise.resolve(
        chairPlanVerdict({ sessions: [{ pid: 38858, plan: { alias, kind: "token" }, sessionId: "a0000032" }] }),
      );
  }

  /** The chair's one session, booted at `bootedIso`, with `changed` canon commits on main since. */
  function canonSince({
    bootedIso,
    changed = [],
  }: {
    bootedIso: string;
    changed?: readonly CanonCommit[];
  }): SupervisorTickRecordDeps["readChairCanon"] {
    return () => new Map([["a0000032", { bootedIso, changed, kind: "measured" } as const]]);
  }

  /** Booted an hour before the fixture's tick instant. */
  const FRESH_BOOT = canonSince({ bootedIso: "2026-09-10T11:20:00.000Z" });

  it("prints the stale-canon block for a chair 40h on canon main has since changed, and records the tick", async () => {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readChairCanon: canonSince({
        bootedIso: "2026-09-08T20:20:00.000Z",
        changed: [
          {
            committedIso: "2026-09-09T10:00:00Z",
            sha: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443",
            subject: "A background bash is stopped at its timeout (#1659)",
          },
        ],
      }),
      readChairPlans: bootedOn({ alias: "plan-three" }),
      readClaudeCode: () => ({
        boots: { kind: "measured", version: "2.1.283" },
        newestInstalled: { kind: "measured", version: "2.1.283" },
        perSession: new Map([["a0000032", { kind: "measured", version: "2.1.283" } as const]]),
      }),
    };

    const code = await runSupervisorTickRecord({
      deps,
      evidence: READ_CHAIR,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
    expect(run.diagnostics.slice(0, 2)).toStrictEqual([
      "supervisor tick-record: HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
      'supervisor tick-record:   - this chair booted 2026-09-08T20:20:00.000Z, 40h ago — at or past 36h — and origin/main has since changed its loaded canon (skills/supervisor, .claude/rules, AGENTS.md) in 1 commit(s), newest 34e48e7b7 "A background bash is stopped at its timeout (#1659)"',
    ]);
  });

  it("prints the hand-off block and STILL records the tick — advisory, never a refusal", async () => {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readChairCanon: FRESH_BOOT,
      readChairPlans: bootedOn({ alias: "plan-five" }),
      readClaudeCode: () => ({
        boots: { kind: "measured", version: "2.1.283" },
        newestInstalled: { kind: "measured", version: "2.1.283" },
        perSession: new Map([["a0000032", { kind: "measured", version: "2.1.280" } as const]]),
      }),
    };

    const code = await runSupervisorTickRecord({
      deps,
      evidence: READ_CHAIR,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
    expect(run.diagnostics).toStrictEqual([
      "supervisor tick-record: HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
      "supervisor tick-record:   - plan-five is at 100% of its seven-day week — at or past 75%, so leave it before the wall",
      "supervisor tick-record:   - plan-five is at 95% of its seven-day Fable week — at or past 75%, so leave it before the wall",
      "supervisor tick-record:   - plan-five is at 95% Fable while plan-three is at 10% — 85 points apart, past the 15-point band",
      "supervisor tick-record:   - this chair runs Claude Code 2.1.280; a fresh boot runs 2.1.283",
      "supervisor tick-record:   route currently picks plan-three for a Fable spawn; the successor boots the current Claude Code on whatever plan routing picks.",
      "supervisor tick-record:   Record this tick, write the handoff, then `slopweaver cmux spawn <handoff slug> --driver claude --model fable` and let the successor take the pin and re-arm the sweep — do NOT re-arm from this chair.",
    ]);
  });

  it("stays silent for a chair booted on the plan routing picks — a chair told to hand off by telemetry", async () => {
    // Every request on the machine stamped plan-three's organisation, whatever token booted the seat; the chair's
    // own descriptor 3 held the routed plan's token, so there is nothing to hand off for.
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readChairCanon: FRESH_BOOT,
      readChairPlans: bootedOn({ alias: "plan-three" }),
      readClaudeCode: () => ({
        boots: { kind: "measured", version: "2.1.283" },
        newestInstalled: { kind: "measured", version: "2.1.283" },
        perSession: new Map([["a0000032", { kind: "measured", version: "2.1.283" } as const]]),
      }),
    };

    const code = await runSupervisorTickRecord({
      deps,
      evidence: READ_CHAIR,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.diagnostics).toStrictEqual([]);
    expect(run.appended.length).toBe(1);
  });

  it("keeps a chair on a plan past the alert bar that the gauge counted level with the chair route", async () => {
    // One chair's close: plan-one at 88% a few hours from its reset, the route moved to plan-three by under a point.
    const level = JSON.stringify({
      ...JSON.parse(GAUGED),
      sources: {
        ...allUnavailable(),
        gauge: {
          facts: {
            chairLevelWith: ["plan-one"],
            nextAllModels: "plan-three",
            nextChair: "plan-three",
            nextFable: "plan-one",
            plans: [
              { fablePct: 36, fiveHourPct: 0, plan: "plan-one", resetsIso: "2026-09-10T20:00:00.000Z", weekPct: 88 },
              { fablePct: 19, fiveHourPct: 0, plan: "plan-three", resetsIso: "2026-09-15T12:00:00.000Z", weekPct: 22 },
            ],
            reactNowLines: [],
          },
          observedAtIso: "2026-09-10T12:10:00.000Z",
          status: "read",
          witness: { command: "slopweaver claude gauge --json", exitCode: 0 },
        },
      },
    });
    const run = capture({ files: { "d.json": level, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readChairCanon: FRESH_BOOT,
      readChairPlans: bootedOn({ alias: "plan-one" }),
      readClaudeCode: () => ({
        boots: { kind: "measured", version: "2.1.283" },
        newestInstalled: { kind: "measured", version: "2.1.283" },
        perSession: new Map([["a0000032", { kind: "measured", version: "2.1.283" } as const]]),
      }),
    };

    const code = await runSupervisorTickRecord({
      deps,
      evidence: READ_CHAIR,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.diagnostics).toStrictEqual([
      "supervisor tick-record: chair cadence: plan-one is at 88% of its seven-day week, but the chair's successor routes to plan-three, level with plan-one within one point of headroom, so a successor would buy no balance — not a reason to hand off until routing moves off it",
    ]);
    expect(run.appended.length).toBe(1);
  });

  /**
   * The tick-record deps for a chair on plan-three, current and freshly booted, with its auto-compactions as given.
   *
   * @param reading the chair session's auto-compaction reading
   * @returns the deps and the capture they write into
   */
  function compactedChair({ reading }: { reading: ChairAutoCompactionReading }): {
    run: ReturnType<typeof capture>;
    deps: SupervisorTickRecordDeps;
  } {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readChairAutoCompactions: () => new Map([["a0000032", reading]]),
      readChairCanon: FRESH_BOOT,
      readChairPlans: bootedOn({ alias: "plan-three" }),
      readClaudeCode: () => ({
        boots: { kind: "measured", version: "2.1.283" },
        newestInstalled: { kind: "measured", version: "2.1.283" },
        perSession: new Map([["a0000032", { kind: "measured", version: "2.1.283" } as const]]),
      }),
    };
    return { deps, run };
  }

  it("keeps a chair four auto-compactions in, printing nothing", async () => {
    const { run, deps } = compactedChair({ reading: { autoCompactions: 4, kind: "below-trial" } });

    const code = await runSupervisorTickRecord({
      deps,
      evidence: READ_CHAIR,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
    expect(run.diagnostics).toStrictEqual([]);
  });

  it("hands off a chair at its fifth auto-compaction — the trial's reason, through the real tick", async () => {
    const { run, deps } = compactedChair({ reading: { autoCompactionsAtLeast: 5, kind: "trial-reached" } });

    const code = await runSupervisorTickRecord({
      deps,
      evidence: READ_CHAIR,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
    expect(run.diagnostics).toStrictEqual([
      "supervisor tick-record: HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
      "supervisor tick-record:   - session a0000032 has been auto-compacted at least 5 times — the 5-auto-compaction trial seats a successor now",
      "supervisor tick-record:   route currently picks plan-three for a Fable spawn; the successor boots the current Claude Code on whatever plan routing picks.",
      "supervisor tick-record:   Record this tick, write the handoff, then `slopweaver cmux spawn <handoff slug> --driver claude --model fable` and let the successor take the pin and re-arm the sweep — do NOT re-arm from this chair.",
    ]);
  });

  it("names an unreadable auto-compaction count UNMEASURED and keeps the chair", async () => {
    const { run, deps } = compactedChair({
      reading: { kind: "unmeasured", why: "line 9 is too long to read, and could be an automatic compaction" },
    });

    const code = await runSupervisorTickRecord({
      deps,
      evidence: READ_CHAIR,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
    expect(run.diagnostics).toStrictEqual([
      "supervisor tick-record: chair cadence: session a0000032: its auto-compactions are UNMEASURED — line 9 is too long to read, and could be an automatic compaction",
    ]);
  });

  it("names what a PARTIAL gauge missed rather than reading it as a complete stay", async () => {
    const partial = JSON.stringify({
      ...JSON.parse(GAUGED),
      sources: {
        ...allUnavailable(),
        gauge: {
          diagnostic: "plan-two was not read: timeout",
          facts: {
            nextAllModels: "plan-one",
            nextChair: "plan-one",
            nextFable: "plan-one",
            plans: [
              { fablePct: 10, fiveHourPct: 5, plan: "plan-one", resetsIso: "2026-09-30T07:00:00.000Z", weekPct: 10 },
            ],
            reactNowLines: [],
          },
          observedAtIso: "2026-09-10T12:10:00.000Z",
          status: "partial",
          witness: { command: "slopweaver claude gauge --json", exitCode: 0 },
        },
      },
    });
    const run = capture({ files: { "d.json": partial, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readChairCanon: FRESH_BOOT,
      readChairPlans: bootedOn({ alias: "plan-one" }),
      readClaudeCode: () => ({
        boots: { kind: "measured", version: "2.1.283" },
        newestInstalled: { kind: "measured", version: "2.1.283" },
        perSession: new Map([["a0000032", { kind: "measured", version: "2.1.283" } as const]]),
      }),
    };

    await runSupervisorTickRecord({ deps, evidence: READ_CHAIR, rest: ["--draft", "d.json", "--reconcile", "r.json"] });

    expect(run.diagnostics).toStrictEqual([
      "supervisor tick-record: chair cadence: the plan gauge is PARTIAL this tick, so a plan it missed is UNMEASURED — plan-two was not read: timeout",
      "supervisor tick-record: chair cadence: the drift band is UNMEASURED — a PARTIAL gauge cannot say which plan routing picks",
    ]);
  });

  /**
   * A draft whose gauge read the chair's plan-five at 80% of its week, beside plan-three nearly untouched.
   *
   * @param routes the gauge's captured routes, `nextChair` absent on a row recorded before the gauge named it
   * @returns the draft's JSON
   */
  function routedDraft({ routes }: { routes: { nextChair?: string; nextFable: string } }): string {
    return JSON.stringify({
      ...JSON.parse(GAUGED),
      sources: {
        ...allUnavailable(),
        gauge: {
          facts: {
            nextAllModels: "plan-three",
            ...routes,
            plans: [
              { fablePct: 20, fiveHourPct: 0, plan: "plan-five", resetsIso: "2026-09-12T07:00:00.000Z", weekPct: 80 },
              { fablePct: 10, fiveHourPct: 0, plan: "plan-three", resetsIso: "2026-09-15T07:00:00.000Z", weekPct: 20 },
            ],
            reactNowLines: [],
          },
          observedAtIso: "2026-09-10T12:10:00.000Z",
          status: "read",
          witness: { command: "slopweaver claude gauge --json", exitCode: 0 },
        },
      },
    });
  }

  /**
   * The recorder's diagnostics for a chair booted on plan-five over one routed draft.
   *
   * @param draft the draft's JSON
   * @returns every diagnostic line it printed
   */
  async function judgedOnPlanFive({ draft }: { draft: string }): Promise<readonly string[]> {
    const run = capture({ files: { "d.json": draft, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readChairCanon: FRESH_BOOT,
      readChairPlans: bootedOn({ alias: "plan-five" }),
      readClaudeCode: () => ({
        boots: { kind: "measured", version: "2.1.283" },
        newestInstalled: { kind: "measured", version: "2.1.283" },
        perSession: new Map([["a0000032", { kind: "measured", version: "2.1.283" } as const]]),
      }),
    };
    await runSupervisorTickRecord({ deps, evidence: READ_CHAIR, rest: ["--draft", "d.json", "--reconcile", "r.json"] });
    return run.diagnostics;
  }

  it("judges the chair against the chair successor's route, not the ordinary Fable route beside it", async () => {
    const diagnostics = await judgedOnPlanFive({
      draft: routedDraft({ routes: { nextChair: "plan-three", nextFable: "plan-five" } }),
    });

    expect(diagnostics.slice(0, 2)).toStrictEqual([
      "supervisor tick-record: HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
      "supervisor tick-record:   - plan-five is at 80% of its seven-day week — at or past 75%, so leave it before the wall",
    ]);
  });

  it("reads a row recorded before the gauge named a chair route as UNMEASURED, never borrowing the Fable route", async () => {
    const diagnostics = await judgedOnPlanFive({ draft: routedDraft({ routes: { nextFable: "plan-five" } }) });

    expect(diagnostics.slice(-2)).toStrictEqual([
      "supervisor tick-record: chair cadence: the plan gauge is PARTIAL this tick, so a plan it missed is UNMEASURED — this tick's gauge named no chair-successor route, so that route is UNMEASURED",
      "supervisor tick-record: chair cadence: the drift band is UNMEASURED — a PARTIAL gauge cannot say which plan routing picks",
    ]);
    expect(diagnostics.some((line) => line.includes("routes to plan-five too"))).toBe(false);
  });

  it("says the cadence was not judged when the gate read nothing", async () => {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });

    await runSupervisorTickRecord({
      deps: run.deps,
      evidence: NOT_READ,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(run.diagnostics).toStrictEqual([
      "supervisor tick-record: chair cadence: not judged, so it is UNMEASURED — this fixture exercises the recorder",
    ]);
    expect(run.appended.length).toBe(1);
  });

  it("names an unresolved chair's plan and Claude Code UNMEASURED rather than calling it a stay", async () => {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });

    const code = await runSupervisorTickRecord({
      deps: run.deps,
      evidence: {
        ...READ_CHAIR,
        chair: { cause: "no-chair", kind: "unresolved", why: "no pinned supervisor workspace" },
      },
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.diagnostics).toStrictEqual([
      "supervisor tick-record: chair cadence: not judged — the chair did not resolve, so its plan and Claude Code are UNMEASURED: no pinned supervisor workspace",
    ]);
    expect(run.appended.length).toBe(1);
  });
});

describe("cadenceLines", () => {
  it("reads no chair and no register when the chair gate did not read the chair", async () => {
    const run = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    await runSupervisorTickRecord({
      deps: run.deps,
      evidence: NOT_READ,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });
    const asked: string[] = [];
    const refuse = ({ what }: { what: string }): never => {
      asked.push(what);
      throw new Error(`the cadence read ${what} for a chair it never saw`);
    };
    const lines = await cadenceLines({
      evidence: NOT_READ,
      home: "/tmp/home",
      reads: {
        readChairAutoCompactions: () => refuse({ what: "an auto-compaction count" }),
        readChairCanon: () => refuse({ what: "a boot and canon" }),
        readChairPlans: () => refuse({ what: "a boot credential" }),
        readClaudeCode: () => refuse({ what: "Claude Code" }),
        readClaudeSide: () => refuse({ what: "the Claude side" }),
        readCodexChairCanon: () => refuse({ what: "a Codex chair's canon" }),
        readCodexSeat: () => refuse({ what: "a Codex seat" }),
        readPlanRegister: () => refuse({ what: "the plan register" }),
      },
      row: run.appended[0]!,
      spawnHome: undefined,
    });
    expect(lines).toStrictEqual([
      "supervisor tick-record: chair cadence: not judged, so it is UNMEASURED — this fixture exercises the recorder",
    ]);
    expect(asked).toStrictEqual([]);
  });
});
