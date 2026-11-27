/**
 * `supervisor chair-watch` over plain fakes and a mkdtemp home: one pass per status, the usage watch, the exit
 * codes, and that neither the JSON nor the human lines carry an account address or a store path.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";

import type { ClaudePlanUsageSnapshot } from "../../../../../claude/planUsageSnapshot.js";
import { chairPlanVerdict } from "../../../../../claude/seatBoot.js";
import {
  type ChairWatchDeps,
  type ChairWatchGateReads,
  CODEX_SEAT_AT_HAND_OFF_NOTE,
  readChairWatch,
  recordedCodexSeatRead,
} from "../../../../../cli/commands/supervisor/chairWatchPass.js";
import {
  appUsageReadOf,
  handOffChairWatchDeps,
  productionChairWatchDeps,
  runSupervisorChairWatch,
} from "../../../../../cli/commands/supervisor/chairWatchRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { PlanRegisterErrors } from "../../../../../plans/errors.js";
import type { PlanRegisterSnapshot } from "../../../../../plans/types.js";
import type { AppSessionUsage, AppUsageReport } from "../../../../../sessionHarness/usageWire.js";
import type { ChairAutoCompactionReading } from "../../../../../supervisor/chairAutoCompaction.js";
import type { ChairRead } from "../../../../../supervisor/chairGate.js";
import { ChairHandOffHoldErrors } from "../../../../../supervisor/chairHandOffHold.js";
import type { ChairWatchHold } from "../../../../../supervisor/chairWatch.js";
import type { ChairWatchAppUsageRead } from "../../../../../supervisor/chairWatchUsageWatch.js";
import { CODEX_ONLY, registeredPlans } from "../../../../chairSuccessorFixture.js";
import { FILL_LANES } from "../../../plans/laneFixtures.js";

const NOW = "2026-11-27T12:00:00.000Z";
const SESSION = "a0000032";

/** Two Claude plans the chair could spend; the fixtures' store paths and addresses are what must never be printed. */
const REGISTER = registeredPlans({
  rows: [
    { alias: "plan-one", email: "seat-1@example.test", provider: "claude", storeDir: "/Users/someone/.claude-seat-1" },
    { alias: "plan-two", provider: "claude", storeDir: "/Users/someone/.claude-seat-2" },
  ],
});

/**
 * A fresh snapshot.
 *
 * @param alias the plan
 * @param week its seven-day fraction
 * @returns the snapshot, taken half an hour before the pass
 */
function fresh({ alias, week }: { alias: string; week: number }): ClaudePlanUsageSnapshot {
  return {
    alias,
    observedAtIso: "2026-11-27T11:30:00.000Z",
    sevenDay: { resetAtIso: "2026-12-01T00:00:00.000Z", status: "allowed", utilization: week },
    sevenDayFable: { resetAtIso: "2026-12-01T00:00:00.000Z", status: "allowed", utilization: week },
  };
}

const SNAPSHOTS: Readonly<Record<string, ClaudePlanUsageSnapshot>> = {
  "plan-one": fresh({ alias: "plan-one", week: 0.2 }),
  "plan-two": fresh({ alias: "plan-two", week: 0.1 }),
};

/**
 * The chair as the gate reads it.
 *
 * @param location where the pinned chair sits
 * @returns a resolved chair with one session on Fable
 */
function resolvedChair({ location }: { location: Extract<ChairRead, { kind: "resolved" }>["location"] }): ChairRead {
  return {
    directory: "/Users/someone/wt/chair",
    kind: "resolved",
    location,
    sessions: [{ pid: 38858, sessionId: SESSION, verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } }],
  };
}

const APP_CHAIR = resolvedChair({ location: { appSessionId: "app-chair-1", kind: "app" } });
const CMUX_CHAIR = resolvedChair({ location: { kind: "cmux", workspaceId: "WS" } });

/**
 * One app session's usage.
 *
 * @param over the fields this case sets
 * @returns the session
 */
function appSession(over: Partial<AppSessionUsage>): AppSessionUsage {
  return {
    chargedModels: ["claude-fable-5-1"],
    ledgerKey: "ledger-1",
    missingTurns: 0,
    modelMismatch: false,
    partialTurns: 0,
    planPath: "/Users/someone/.claude-seat-1",
    rate: { kind: "reported", totalTokensPerHour: 1200.4 },
    reportedTurns: 2,
    resolvedModel: "claude-fable-5-1",
    sessionId: "app-chair-1",
    state: "idle",
    title: "the owner's own words",
    total: {
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      inputTokens: 400,
      outputTokens: 100,
      totalTokens: 500,
      vendor: "claude",
    },
    turnOpen: false,
    vendor: "claude",
    ...over,
  };
}

const APP_REPORT: AppUsageReport = {
  atIso: NOW,
  sessions: [
    appSession({ askedModel: "claude-fable-5-1" }),
    appSession({
      askedModel: "claude-fable-5-1",
      chargedModels: ["claude-sonnet-5"],
      modelMismatch: true,
      rate: { kind: "not-elapsed" },
      resolvedModel: "claude-sonnet-5",
      sessionId: "app-seat-2",
    }),
  ],
};

/** What one fake pass is built from. */
interface WatchCase {
  readonly chair?: ChairRead;
  readonly compactions?: ChairAutoCompactionReading;
  readonly hold?: ChairWatchHold;
  readonly holdUnreadable?: boolean;
  readonly register?: PlanRegisterSnapshot;
  readonly registerUnreadable?: boolean;
  readonly app?: ChairWatchAppUsageRead;
  readonly gate?: Partial<ChairWatchGateReads>;
  readonly codexCanonThrows?: boolean;
  readonly codexSeat?: ChairWatchDeps["cadenceReads"]["readCodexSeat"];
}

/** The seams a case leaves unset read these: an app chair below the trial, the register and one app report. */
const CASE_DEFAULTS: {
  readonly app: ChairWatchAppUsageRead;
  readonly chair: ChairRead;
  readonly codexSeat: ChairWatchDeps["cadenceReads"]["readCodexSeat"];
  readonly compactions: ChairAutoCompactionReading;
  readonly register: PlanRegisterSnapshot;
} = {
  app: { kind: "report", report: APP_REPORT },
  chair: APP_CHAIR,
  codexSeat: () => Promise.reject(new Error("a Claude successor never asks for a Codex seat")),
  compactions: { autoCompactions: 1, kind: "below-trial" },
  register: REGISTER,
};

/**
 * The watch's deps over plain fakes.
 *
 * @param watch the case
 * @returns every seam the pass reads through
 */
function watchDeps(watch: WatchCase): ChairWatchDeps {
  const { register, chair, compactions, app, codexSeat } = { ...CASE_DEFAULTS, ...watch };
  return {
    cadenceReads: {
      readChairAutoCompactions: () => new Map([[SESSION, compactions]]),
      readChairCanon: () =>
        new Map([[SESSION, { bootedIso: "2026-11-27T11:00:00.000Z", changed: [], kind: "measured" }]]),
      readChairPlans: () =>
        Promise.resolve(
          chairPlanVerdict({
            sessions: [{ pid: 38858, plan: { alias: "plan-one", kind: "token" }, sessionId: SESSION }],
          }),
        ),
      readClaudeCode: () => ({
        boots: { kind: "measured", version: "2.1.283" },
        newestInstalled: { kind: "measured", version: "2.1.283" },
        perSession: new Map([[SESSION, { kind: "measured", version: "2.1.283" } as const]]),
      }),
      readClaudeSide: () => Promise.reject(new Error("a Claude successor never reads the ambient Claude side")),
      readCodexChairCanon: ({ bootedIso }) => {
        if (watch.codexCanonThrows === true) {
          throw new Error("the Codex canon read failed at /Users/someone/wt");
        }
        return { bootedIso, changed: [], kind: "measured" };
      },
      readCodexSeat: codexSeat,
      readPlanRegister: () =>
        Promise.resolve(
          watch.registerUnreadable === true
            ? err(PlanRegisterErrors.registerUnreadable({ path: "/Users/someone/.slopweaver/plans.json" }))
            : ok(register),
        ),
    },
    chairReads: () => ({
      readChair: () => Promise.resolve(chair),
      readLanes: () => Promise.resolve(FILL_LANES),
      readRecordedChair: () => ({ kind: "absent" }),
      ...watch.gate,
    }),
    nowIso: () => NOW,
    readAppUsage: () => Promise.resolve(app),
    readHold: () =>
      watch.holdUnreadable === true
        ? err(ChairHandOffHoldErrors.lineMalformed({ lineNumber: 3, path: "/x/holds.jsonl", why: "it is not JSON" }))
        : ok(watch.hold),
    readSnapshot: ({ alias }) => ok(SNAPSHOTS[alias]),
    readSpends: () => [],
  };
}

const TRIAL_REACHED: ChairAutoCompactionReading = { autoCompactionsAtLeast: 5, kind: "trial-reached" };
const TRIAL_REASON =
  "session a0000032 has been auto-compacted at least 5 times — the 5-auto-compaction trial seats a successor now";

describe("readChairWatch", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "watch-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reports STAY for a measured app chair with nothing to hand off for", async () => {
    const report = await readChairWatch({ deps: watchDeps({}), home });

    expect(report.status).toBe("stay");
    expect(report.reasons).toStrictEqual([]);
    expect(report.successor).toBeUndefined();
    expect(report.chair).toStrictEqual({ appSessionId: "app-chair-1", kind: "app", sessionIds: [SESSION] });
    expect(report.readings.map((reading) => [reading.alias, reading.state, reading.chair])).toStrictEqual([
      ["plan-one", "measured", true],
      ["plan-two", "measured", false],
    ]);
    expect(report.overrides).toStrictEqual([
      "slopweaver supervisor hand-off --plan <alias>",
      'slopweaver supervisor hand-off --now --reason "<why>"',
      'slopweaver supervisor hand-off hold --reason "<why>"',
    ]);
  });

  it("reports HAND-OFF with the reason and the routed successor's plan", async () => {
    const report = await readChairWatch({ deps: watchDeps({ compactions: TRIAL_REACHED }), home });

    expect(report.status).toBe("hand-off");
    expect(report.reasons).toStrictEqual([TRIAL_REASON]);
    expect(report.successor).toStrictEqual({ alias: "plan-two", target: { kind: "claude" } });
  });

  it("reports HELD beside the hand-off it holds back, and offers the release", async () => {
    const hold = { reason: "mid-demo", sinceIso: "2026-11-27T11:00:00.000Z" };

    const report = await readChairWatch({ deps: watchDeps({ compactions: TRIAL_REACHED, hold }), home });

    expect(report.status).toBe("held");
    expect(report.hold).toStrictEqual(hold);
    expect(report.reasons).toStrictEqual([TRIAL_REASON]);
    expect(report.overrides[2]).toBe('slopweaver supervisor hand-off release --reason "<why>"');
  });

  it("reports UNSUPPORTED for a cmux chair the cadence would hand off", async () => {
    const report = await readChairWatch({ deps: watchDeps({ chair: CMUX_CHAIR, compactions: TRIAL_REACHED }), home });

    expect(report.status).toBe("unsupported");
    expect(report.chair).toStrictEqual({ kind: "cmux", sessionIds: [SESSION], workspaceId: "WS" });
    expect(report.reasons).toStrictEqual([TRIAL_REASON]);
  });

  it("reports UNMEASURED for a chair that did not resolve, naming why", async () => {
    const report = await readChairWatch({
      deps: watchDeps({
        chair: { cause: "no-chair", kind: "unresolved", why: "no pinned supervisor workspace" },
        compactions: TRIAL_REACHED,
      }),
      home,
    });

    expect(report.status).toBe("unmeasured");
    expect(report.chair).toStrictEqual({ kind: "unresolved", why: "no pinned supervisor workspace" });
    expect(report.notes).toStrictEqual([
      "chair cadence: not judged — the chair did not resolve, so its plan and Claude Code are UNMEASURED: no pinned supervisor workspace",
    ]);
  });

  it("reports UNMEASURED when the hold cannot be read, rather than reading it as unheld", async () => {
    const report = await readChairWatch({
      deps: watchDeps({ compactions: TRIAL_REACHED, holdUnreadable: true }),
      home,
    });

    expect(report.status).toBe("unmeasured");
    expect(report.notes.at(-1)).toBe(
      "the owner's hand-off hold could not be read, so this pass is UNMEASURED — the hand-off hold journal's line 3 is not a hold or release line: it is not JSON",
    );
  });

  it("reports a Codex chair the records name, never reading a Claude tab", async () => {
    const report = await readChairWatch({
      deps: watchDeps({
        gate: {
          readChair: () => Promise.reject(new Error("a Codex chair never reads a Claude tab")),
          readRecordedChair: () => ({
            kind: "session",
            pinnedAtIso: "2026-11-27T11:00:00.000Z",
            session: { host: "codex", id: "thread-1" },
          }),
        },
      }),
      home,
    });

    expect(report.chair).toStrictEqual({ kind: "codex", threadId: "thread-1" });
    expect(report.status).toBe("stay");
  });

  it("keeps the chair it found when a cadence read throws, and names the throw by its class alone", async () => {
    const report = await readChairWatch({
      deps: watchDeps({
        codexCanonThrows: true,
        gate: {
          readRecordedChair: () => ({
            kind: "session",
            pinnedAtIso: "2026-11-27T11:00:00.000Z",
            session: { host: "codex", id: "thread-1" },
          }),
        },
      }),
      home,
    });

    expect(report.chair).toStrictEqual({ kind: "codex", threadId: "thread-1" });
    expect(report.status).toBe("unmeasured");
    expect(report.notes).toStrictEqual(["chair cadence: not judged — a cadence read threw (Error)"]);
  });

  it("names an unread register by its code and keeps the pass going", async () => {
    const report = await readChairWatch({ deps: watchDeps({ registerUnreadable: true }), home });

    expect(report.notes[0]).toBe(
      "the plan register could not be read (REGISTER_UNREADABLE), so every plan is UNMEASURED",
    );
    expect(report.readings).toStrictEqual([]);
    expect(report.usage.gaps[0]).toBe(
      "the plan register could not be read (REGISTER_UNREADABLE), so no session's plan is named",
    );
  });

  it("watches each session's asked against ran model and rate, and each plan's tokens beside its reading", async () => {
    const report = await readChairWatch({ deps: watchDeps({}), home });

    expect(report.usage).toStrictEqual({
      gaps: [],
      plans: [{ alias: "plan-one", appTokens: 1000, modelHostReading: "measured: week 20%, Fable week 20%" }],
      sessions: [
        {
          askedModel: "claude-fable-5-1",
          plan: "plan-one",
          ranModel: "claude-fable-5-1",
          sessionId: "app-chair-1",
          tokensPerHour: 1200.4,
        },
        {
          askedModel: "claude-fable-5-1",
          mismatch: "asked for claude-fable-5-1, ran claude-sonnet-5",
          plan: "plan-one",
          ranModel: "claude-sonnet-5",
          sessionId: "app-seat-2",
        },
      ],
    });
  });

  it("names a Codex successor as chosen at hand-off time, through the read that reads and records nothing", async () => {
    const report = await readChairWatch({
      deps: watchDeps({ codexSeat: recordedCodexSeatRead, compactions: TRIAL_REACHED, register: CODEX_ONLY }),
      home,
    });

    expect(report.status).toBe("hand-off");
    expect(report.successor).toStrictEqual({ target: { kind: "codex" } });
    expect(report.notes.filter((note) => note === CODEX_SEAT_AT_HAND_OFF_NOTE)).toStrictEqual([
      CODEX_SEAT_AT_HAND_OFF_NOTE,
    ]);
  });

  it("names an unreachable app as a gap and still completes the pass", async () => {
    const report = await readChairWatch({
      deps: watchDeps({ app: { kind: "failed", why: "the desktop app did not answer (ENOENT)" } }),
      home,
    });

    expect(report.status).toBe("stay");
    expect(report.usage).toStrictEqual({
      gaps: ["the app's usage could not be read: the desktop app did not answer (ENOENT)"],
      plans: [],
      sessions: [],
    });
  });
});

describe("the watch's production reads", () => {
  it("wire the Codex seat read that records nothing into chair-watch, and the live decision into hand-off only", () => {
    expect(productionChairWatchDeps().cadenceReads.readCodexSeat).toBe(recordedCodexSeatRead);
    expect(handOffChairWatchDeps().cadenceReads.readCodexSeat).not.toBe(recordedCodexSeatRead);
  });
});

describe("runSupervisorChairWatch", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "watch-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /**
   * Run the verb over fakes.
   *
   * @param rest the flag tail
   * @param watch the case
   * @returns the exit code and what it printed
   */
  async function run({
    rest,
    watch,
  }: {
    rest: readonly string[];
    watch: WatchCase;
  }): Promise<{ code: number; out: string[]; diagnostics: string[] }> {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runSupervisorChairWatch({
      deps: {
        ...watchDeps(watch),
        writeDiagnostic: (line) => {
          diagnostics.push(line);
        },
        writeOut: (line) => {
          out.push(line);
        },
      },
      rest,
    });
    return { code, diagnostics, out };
  }

  it("prints the status line first, then short sections, and exits 0 on a hand-off", async () => {
    const result = await run({ rest: ["--home", home], watch: { compactions: TRIAL_REACHED } });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out.slice(0, 6)).toStrictEqual([
      "chair-watch: HAND-OFF — 1 reason(s); successor on plan-two (claude)",
      "reasons:",
      `  - ${TRIAL_REASON}`,
      "plans:",
      "  plan-one (chair): measured — week 20%, Fable week 20%",
      "  plan-two: measured — week 10%, Fable week 10%",
    ]);
    expect(result.out).toContain("  app-seat-2 on plan-one, MISMATCH asked for claude-fable-5-1, ran claude-sonnet-5");
    expect(result.out).toContain("  app-chair-1 on plan-one, claude-fable-5-1, 1200 tokens/h");
  });

  it("prints the report as one JSON document under --json", async () => {
    const result = await run({ rest: ["--home", home, "--json"], watch: {} });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out.length).toBe(1);
    expect((JSON.parse(result.out[0]!) as { status: string }).status).toBe("stay");
  });

  it("refuses an unknown flag with usage, before reading anything", async () => {
    const result = await run({ rest: ["--loop"], watch: {} });

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.out).toStrictEqual([]);
    expect(result.diagnostics.at(-1)!.startsWith("usage: slopweaver supervisor chair-watch")).toBe(true);
  });

  it("prints usage on --help and exits 0", async () => {
    const result = await run({ rest: ["--help"], watch: {} });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out[0]!.startsWith("usage: slopweaver supervisor chair-watch [--home <dir>] [--json]")).toBe(true);
  });

  it("names no account address and no store path, in JSON or in the human lines", async () => {
    // The input carries both: the register row's address and store, and the app's plan path is that store.
    expect(REGISTER.plans[0]!.email).toBe("seat-1@example.test");
    expect(REGISTER.plans[0]!.storeDir).toBe("/Users/someone/.claude-seat-1");
    expect(APP_REPORT.sessions[0]!.planPath).toBe("/Users/someone/.claude-seat-1");

    const json = await run({ rest: ["--home", home, "--json"], watch: { compactions: TRIAL_REACHED } });
    const human = await run({ rest: ["--home", home], watch: { compactions: TRIAL_REACHED } });

    const printed = [...json.out, ...json.diagnostics, ...human.out, ...human.diagnostics].join("\n");
    expect(printed).toContain("plan-one");
    expect(printed).not.toContain("seat-1@example.test");
    expect(printed).not.toContain("/Users/someone");
    expect(printed).not.toContain("the owner's own words");
  });
});

describe("appUsageReadOf", () => {
  it("names an unreachable app by its cause code, never its message", () => {
    expect(
      appUsageReadOf({
        answered: err({ causeCode: "ENOENT", kind: "unreachable", message: "connect ENOENT /tmp/slopweaver-app.sock" }),
      }),
    ).toStrictEqual({ kind: "failed", why: "the desktop app did not answer (ENOENT)" });
  });

  it("names an app that predates usage", () => {
    expect(
      appUsageReadOf({ answered: err({ code: "BAD_REQUEST", kind: "refused", message: "unknown request kind" }) }),
    ).toStrictEqual({ kind: "failed", why: "this desktop app predates usage; update it" });
  });

  it("passes a usage answer through as the report", () => {
    expect(appUsageReadOf({ answered: ok({ kind: "usage", report: APP_REPORT }) })).toStrictEqual({
      kind: "report",
      report: APP_REPORT,
    });
  });
});
