/**
 * One `supervisor chair-watch` pass over injected reads (`./chairWatchRun.ts` is the verb, and wires the production
 * reads): the register folded into a gauge of RECORDED readings (`../../../supervisor/chairWatchGauge.ts`), the chair
 * read the way the chair gate reads it with none of its effects, the tick's own cadence judged on that gauge, the
 * owner's hold, and the desktop app's usage report — folded into one report with no account address or store path.
 *
 * Every read a pass makes arrives through {@link ChairWatchDeps}, so a test drives a whole pass over plain fakes and a
 * mkdtemp home. A throw from the chair and cadence reads is a note in the report rather than a crashed pass; the
 * register, snapshot, spend and hold reads are NOT throw-guarded here, because each answers a Result and its failure
 * becomes a note or a gap that way.
 */
import { chairPlansOf } from "../../../claude/chairBudgetAlert.js";
import type { ClaudeAccount, ClaudePlanSpend } from "../../../claude/contracts.js";
import type { ClaudePlanUsageSnapshot } from "../../../claude/planUsageSnapshot.js";
import { ok, type Result } from "../../../lib/result.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import type { ChairCadenceGauge } from "../../../supervisor/chairCadence.js";
import { reasonLine } from "../../../supervisor/chairCadenceLines.js";
import type { ChairHandOffHoldError } from "../../../supervisor/chairHandOffHold.js";
import {
  type ChairWatchChair,
  type ChairWatchHold,
  type ChairWatchReading,
  type ChairWatchReport,
  chairWatchStatus,
  reportWithoutAddresses,
} from "../../../supervisor/chairWatch.js";
import {
  markChairReadings,
  type RecordedClaudeSnapshot,
  recordedChairGauge,
} from "../../../supervisor/chairWatchGauge.js";
import { type ChairWatchAppUsageRead, chairWatchUsageOf } from "../../../supervisor/chairWatchUsageWatch.js";
import { recordedChairDecision } from "./chairGateRecorded.js";
import type { ChairGateDeps, ChairGateEvidence } from "./chairGateRun.js";
import {
  type ChairSuccessorCodexSeatRead,
  judgeChairCadenceOn,
  type TickCadence,
  type TickCadenceReads,
} from "./tickRecordCadence.js";

/** What {@link recordedCodexSeatRead} answers: the Codex seat is confirmed by `supervisor hand-off`, not by the watch. */
const CODEX_SEAT_AT_HAND_OFF = { kind: "read-at-hand-off" } as const;

/** The note a pass carries when it named a Codex successor without the live seat read. */
export const CODEX_SEAT_AT_HAND_OFF_NOTE =
  "the Codex successor is named as chosen at hand-off time: its live seat read (sign-in, usage, cached cap) " +
  "records what it finds, so this read-only pass does not make it — `supervisor hand-off` does, before it seats one";

/**
 * The watch's Codex seat read: it reads nothing and records nothing, and lets a Codex pick stand as the successor's
 * vendor, so `supervisor chair-watch` stays read-only. The live decision (`decideCodexSeat`, which files sign-in
 * observations and the fleet-cap record and writes a temporary `read.tcl`) is made by `supervisor hand-off`, whose
 * own watch pass wires `liveChairCodexSeatRead` instead (`./chairWatchRun.ts`'s `handOffChairWatchDeps`).
 *
 * @returns the read-at-hand-off seat, always, so a Codex pick stands unread
 */
export const recordedCodexSeatRead: ChairSuccessorCodexSeatRead = async () => ok(CODEX_SEAT_AT_HAND_OFF);

/** The chair gate's reads the watch makes — the records, the pinned chair and the plan lanes, nothing else. */
export type ChairWatchGateReads = Pick<ChairGateDeps, "readChair" | "readLanes" | "readRecordedChair">;

/** Every read the watch makes, injected so a test drives a pass over a mkdtemp home and plain fakes. */
export interface ChairWatchDeps {
  /** The pass's instant. */
  readonly nowIso: () => string;
  /** The chair gate's own reads for one home. */
  readonly chairReads: (options: { home: string }) => ChairWatchGateReads;
  /** The reads the cadence judges through, the tick's own; `readPlanRegister` is also the watch's register read. */
  readonly cadenceReads: TickCadenceReads;
  /** One Claude plan's last recorded weekly snapshot, `undefined` when none was recorded. */
  readonly readSnapshot: (request: {
    alias: string;
    home: string;
  }) => Result<ClaudePlanUsageSnapshot | undefined, string>;
  /** Each monthly-spend plan's verdict off the local ledger (`readClaudePlanSpends`). */
  readonly readSpends: (request: {
    accounts: readonly ClaudeAccount[];
    home: string;
    nowIso: string;
  }) => readonly ClaudePlanSpend[];
  /** The owner's hold in force. */
  readonly readHold: (request: { home: string }) => Result<ChairWatchHold | undefined, ChairHandOffHoldError>;
  /** The desktop app's usage report, or why it gave none. */
  readonly readAppUsage: () => Promise<ChairWatchAppUsageRead>;
}

/**
 * What the chair gate would hand its verb, read without any of its effects. The caller of a watch is the control
 * plane, never a chair, so only the records decide whether a Codex thread holds the chair.
 *
 * @param reads the gate's reads for this home
 * @returns the evidence the cadence judges on
 */
async function readEvidence({ reads }: { reads: ChairWatchGateReads }): Promise<ChairGateEvidence> {
  const decision = recordedChairDecision({ caller: { kind: "missing" }, recorded: reads.readRecordedChair() });
  if (decision.kind === "step-aside") {
    return decision.evidence;
  }
  const chair = await reads.readChair();
  const lanes = await reads.readLanes();
  return { chair, kind: "read", lanes };
}

/**
 * Where the watch found the chair.
 *
 * @param evidence what the gate's reads concluded
 * @returns the chair's host and sessions, or why it did not resolve
 */
function watchChairOf({ evidence }: { evidence: ChairGateEvidence }): ChairWatchChair {
  if (evidence.kind === "not-read") {
    return { kind: "unresolved", why: evidence.why };
  }
  if (evidence.kind === "codex") {
    return { kind: "codex", threadId: evidence.threadId };
  }
  const { chair } = evidence;
  if (chair.kind === "unresolved") {
    return { kind: "unresolved", why: chair.why };
  }
  const sessionIds = chair.sessions.map((session) => session.sessionId);
  if (chair.location.kind === "app") {
    return { appSessionId: chair.location.appSessionId, kind: "app", sessionIds };
  }
  return { kind: "cmux", sessionIds, workspaceId: chair.location.workspaceId };
}

/** The cadence's conclusion as the watch reports it. */
interface CadenceOutcome {
  readonly kind: "stay" | "hand-off" | "unmeasured";
  readonly reasons: readonly string[];
  readonly notes: readonly string[];
  readonly successor?: ChairWatchReport["successor"];
}

/**
 * The cadence's conclusion as the watch reports it: the verdict, every reason rendered, the successor, the notes.
 *
 * @param cadence what the cadence judged
 * @returns the three-way conclusion and what it carries
 */
function cadenceOutcome({ cadence }: { cadence: TickCadence }): CadenceOutcome {
  if (cadence.kind === "not-judged") {
    return { kind: "unmeasured", notes: cadence.lines, reasons: [] };
  }
  if (cadence.close.kind === "stay") {
    return { kind: "stay", notes: cadence.notes, reasons: [] };
  }
  const { route, reasons } = cadence.close.verdict;
  const { target } = cadence.close;
  const alias = target.kind === "claude" && route.kind === "picks" ? route.alias : undefined;
  return {
    kind: "hand-off",
    notes: cadence.notes,
    reasons: reasons.map((reason) => reasonLine({ reason })),
    successor: { target, ...(alias === undefined ? {} : { alias }) },
  };
}

/**
 * Each way the owner can change this outcome.
 *
 * @param hold the hold in force, when one is
 * @returns one command line each
 */
function overridesOf({ hold }: { hold: ChairWatchHold | undefined }): readonly string[] {
  let holdLine = 'slopweaver supervisor hand-off hold --reason "<why>"';
  if (hold !== undefined) {
    holdLine = 'slopweaver supervisor hand-off release --reason "<why>"';
  }
  return [
    "slopweaver supervisor hand-off --plan <alias>",
    'slopweaver supervisor hand-off --now --reason "<why>"',
    holdLine,
  ];
}

/**
 * The chair and its cadence, judged on the recorded gauge, a throw reported rather than raised: a pass on a timer
 * that crashed on one read would report nothing at all.
 *
 * @param gateReads the gate's reads for this home
 * @param gauge the recorded gauge
 * @param home the state home the cadence's register read is pointed at
 * @param nowIso the pass's instant
 * @param reads the cadence's reads
 * @returns the cadence, or `not-judged` naming the read that threw, and where the chair was found
 */
async function judgeOrNote({
  gateReads,
  gauge,
  home,
  nowIso,
  reads,
}: {
  gateReads: ChairWatchGateReads;
  gauge: ChairCadenceGauge;
  home: string;
  nowIso: string;
  reads: TickCadenceReads;
}): Promise<{ cadence: TickCadence; chair: ChairWatchChair }> {
  let evidence: ChairGateEvidence;
  try {
    evidence = await readEvidence({ reads: gateReads });
  } catch (error: unknown) {
    const why = thrownName({ error });
    return {
      cadence: { kind: "not-judged", lines: [`chair cadence: not judged — the chair read threw (${why})`] },
      chair: { kind: "unresolved", why: `the chair read threw (${why})` },
    };
  }
  const chair = watchChairOf({ evidence });
  try {
    // No `spawnHome`: the successor's target names no home, so the report names no path; the hand-off re-reads
    // its own home.
    const cadence = await judgeChairCadenceOn({ evidence, gauge, home, nowIso, reads, spawnHome: undefined });
    return { cadence, chair };
  } catch (error: unknown) {
    return {
      cadence: {
        kind: "not-judged",
        lines: [`chair cadence: not judged — a cadence read threw (${thrownName({ error })})`],
      },
      chair,
    };
  }
}

/**
 * A thrown value named by its class alone: a read's message can carry a path.
 *
 * @param error what was thrown
 * @returns e.g. `Error`, `TypeError`
 */
export function thrownName({ error }: { error: unknown }): string {
  if (error instanceof Error) {
    return error.name;
  }
  return "a non-error value";
}

/** What the register read gave the watch. */
interface RegisterPart {
  readonly plans: readonly RegisteredPlan[];
  readonly gauge: ChairCadenceGauge;
  readonly readings: readonly ChairWatchReading[];
  readonly note?: string;
  readonly registerGap?: string;
}

/**
 * The register, its recorded snapshots and spends, folded into the gauge the cadence judges on.
 *
 * @param home the state home
 * @param deps the reads
 * @param nowIso the pass's instant
 * @returns the plans, the gauge and the readings, or the note and gap an unread register leaves
 */
async function registerPart({
  home,
  deps,
  nowIso,
}: {
  home: string;
  deps: ChairWatchDeps;
  nowIso: string;
}): Promise<RegisterPart> {
  const register = await deps.cadenceReads.readPlanRegister({ home });
  if (register.isErr()) {
    // The register's message can name its file, so the watch names the failure's code alone.
    const { code } = register.error;
    return {
      gauge: { kind: "unmeasured", why: `the plan register could not be read (${code})` },
      note: `the plan register could not be read (${code}), so every plan is UNMEASURED`,
      plans: [],
      readings: [],
      registerGap: `the plan register could not be read (${code}), so no session's plan is named`,
    };
  }
  const { plans } = register.value;
  const claude = plans.filter((plan) => plan.provider === "claude" && plan.paused === undefined);
  const snapshots: RecordedClaudeSnapshot[] = claude
    .filter((plan) => plan.allowance.kind === "weekly-window")
    .map((plan): RecordedClaudeSnapshot => {
      const read = deps.readSnapshot({ alias: plan.alias, home });
      if (read.isErr()) {
        return { alias: plan.alias, read: { kind: "unreadable", reason: read.error } };
      }
      return { alias: plan.alias, read: { kind: "read", value: read.value } };
    });
  const built = recordedChairGauge({
    nowIso,
    plans,
    snapshots,
    spends: deps.readSpends({ accounts: claude, home, nowIso }),
    thresholds: register.value.thresholds.claude,
  });
  return { gauge: built.gauge, plans, readings: built.readings };
}

/**
 * The cadence reads, wrapped so the pass learns what two of them answered: the chair's plans (to mark its
 * readings) and whether the Codex seat was left to the hand-off (to say so in a note).
 *
 * @param reads the pass's own cadence reads, delegated to unchanged
 * @returns the wrapped reads, and what they saw once the cadence has run
 */
function watchedReads({ reads }: { reads: TickCadenceReads }): {
  reads: TickCadenceReads;
  seen: { chairPlans: readonly string[]; codexSeatDeferred: boolean };
} {
  const seen: { chairPlans: readonly string[]; codexSeatDeferred: boolean } = {
    chairPlans: [],
    codexSeatDeferred: false,
  };
  return {
    reads: {
      ...reads,
      readChairPlans: async (options) => {
        const read = await reads.readChairPlans(options);
        seen.chairPlans = chairPlansOf({ sessions: read.sessions });
        return read;
      },
      readCodexSeat: async (options) => {
        const seat = await reads.readCodexSeat(options);
        seen.codexSeatDeferred = seat.isOk() && seat.value === CODEX_SEAT_AT_HAND_OFF;
        return seat;
      },
    },
    seen,
  };
}

/**
 * One watch pass.
 *
 * @param home the Slopweaver home whose register, snapshots, records and hold are read
 * @param deps every read the pass makes
 * @returns the report, whatever its status
 */
export async function readChairWatch({
  home,
  deps,
}: {
  home: string;
  deps: ChairWatchDeps;
}): Promise<ChairWatchReport> {
  const observedAtIso = deps.nowIso();
  const part = await registerPart({ deps, home, nowIso: observedAtIso });
  const notes: string[] = part.note === undefined ? [] : [part.note];
  const watched = watchedReads({ reads: deps.cadenceReads });
  const judged = await judgeOrNote({
    gateReads: deps.chairReads({ home }),
    gauge: part.gauge,
    home,
    nowIso: observedAtIso,
    reads: watched.reads,
  });
  const outcome = cadenceOutcome({ cadence: judged.cadence });
  notes.push(...outcome.notes);
  if (watched.seen.codexSeatDeferred && outcome.successor?.target.kind === "codex") {
    notes.push(CODEX_SEAT_AT_HAND_OFF_NOTE);
  }
  let cadenceKind = outcome.kind;
  let hold: ChairWatchHold | undefined;
  const held = deps.readHold({ home });
  if (held.isErr()) {
    // Unreadable is not "unheld": reading it so could hand off against the owner's word.
    notes.push(`the owner's hand-off hold could not be read, so this pass is UNMEASURED — ${held.error.message}`);
    cadenceKind = "unmeasured";
  } else {
    hold = held.value;
  }
  const readings = markChairReadings({ chairPlans: watched.seen.chairPlans, readings: part.readings });
  const usage = chairWatchUsageOf({
    app: await deps.readAppUsage(),
    plans: part.plans,
    readings,
    registerGap: part.registerGap,
  });
  return reportWithoutAddresses({
    report: {
      chair: judged.chair,
      notes,
      observedAtIso,
      overrides: overridesOf({ hold }),
      readings,
      reasons: outcome.reasons,
      status: chairWatchStatus({ cadence: cadenceKind, chair: judged.chair, hold }),
      usage,
      ...(hold === undefined ? {} : { hold }),
      ...(outcome.successor === undefined ? {} : { successor: outcome.successor }),
    },
  });
}
