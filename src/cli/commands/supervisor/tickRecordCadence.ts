/**
 * The chair's hand-off cadence as a tick judges it: advisory lines judged off what the chair gate read on its way
 * past, the tick's own captured gauge, the Claude Code versions in play, and how long the chair has run on canon
 * main has since changed. A Codex chair takes its own branch, judged on its canon alone and never through a Claude
 * read. `supervisor tick close` — the path every sweep takes — and the lower `tick-record` both judge it here.
 */
import type { ClaudeCodeVersionReading } from "../../../claude/claudeCodeVersion.js";
import type { GaugeChair } from "../../../claude/seatBoot.js";
import type { Result } from "../../../lib/result.js";
import type { PlanRegisterError } from "../../../plans/errors.js";
import type { PlanRegisterSnapshot } from "../../../plans/types.js";
import {
  type ChairCadenceGauge,
  type ChairCadenceVerdict,
  chairCadenceSessions,
  judgeChairCadence,
} from "../../../supervisor/chairCadence.js";
import { chairCadenceLines } from "../../../supervisor/chairCadenceLines.js";
import { chairCadenceRouteOf } from "../../../supervisor/chairCadenceRoute.js";
import { cadenceThresholdsOf } from "../../../supervisor/chairCadenceThresholds.js";
import type { ChairCanonReading } from "../../../supervisor/chairCanon.js";
import {
  type ChairContextJudgement,
  type ChairContextReading,
  judgeChairContext,
} from "../../../supervisor/chairContext.js";
import type { ChairRead } from "../../../supervisor/chairGate.js";
import type { ClosePromptCadence } from "../../../supervisor/chairHandOffPrompt.js";
import {
  ambientClaudeSuccessor,
  ambientClaudeVerdict,
  chairSuccessorTarget,
  codexSeatVerdict,
  targetOnHome,
} from "../../../supervisor/chairSuccessor.js";
import { judgeCodexChairCadence } from "../../../supervisor/codexChairCadence.js";
import type { SupervisorTickRow } from "../../../supervisor/tickTypes.js";
import type { ChairGateEvidence } from "./chairGateRun.js";

/**
 * Read each resolved chair session's plan off the credential it booted on.
 *
 * @internal — a field type of {@link TickCadenceReads}.
 */
export type ChairBootPlanRead = (options: { chair: Extract<ChairRead, { kind: "resolved" }> }) => Promise<GaugeChair>;

/**
 * Read each chair session's boot and the canon commits `origin/main` has landed since, by session id.
 *
 * @internal — a field type of {@link TickCadenceReads}.
 */
export type ChairCanonRead = (options: { chair: ChairRead }) => ReadonlyMap<string, ChairCanonReading>;

/**
 * The Claude Code versions the cadence compares.
 *
 * @internal — a field type of {@link TickCadenceReads}.
 */
export interface ChairClaudeCodeReading {
  readonly perSession: ReadonlyMap<string, ClaudeCodeVersionReading>;
  readonly boots: ClaudeCodeVersionReading;
  readonly newestInstalled: ClaudeCodeVersionReading;
}

/**
 * The tick's captured gauge, as the cadence reads it.
 *
 * The route is the chair successor's own, `nextChair`, never the ordinary `nextFable`: the chair's spawn lines its Fable week
 * up as a Fable seat is gated, which an ordinary Fable seat does not. `chairLevelWith` rides with it, absent on an older row. A row captured before the gauge named that
 * route reads PARTIAL with the route UNMEASURED, so its plan reasons are judged as any partial gauge's are.
 *
 * @param gauge the draft's gauge observation
 * @returns its plans and the chair's route (naming what a partial read missed), or why the tick has none
 */
function cadenceGaugeOf({ gauge }: { gauge: SupervisorTickRow["sources"]["gauge"] }): ChairCadenceGauge {
  if (gauge.status === "unavailable") {
    return { kind: "unmeasured", why: gauge.diagnostic };
  }
  const { chairLevelWith, nextChair } = gauge.facts;
  const read = {
    ...(chairLevelWith === undefined ? {} : { chairLevelWith }),
    kind: "read",
    nextChair: nextChair === undefined ? null : nextChair,
    plans: gauge.facts.plans,
    thresholds: cadenceThresholdsOf({ facts: gauge.facts }),
    ...(gauge.facts.weekOnlyPlans === undefined ? {} : { weekOnly: gauge.facts.weekOnlyPlans }),
  } as const;
  const gaps = [
    ...(gauge.status === "partial" ? [gauge.diagnostic] : []),
    ...(nextChair === undefined
      ? ["this tick's gauge named no chair-successor route, so that route is UNMEASURED"]
      : []),
  ];
  if (gaps.length > 0) {
    return { ...read, gap: gaps.join("; ") };
  }
  return read;
}

/**
 * Read the plan register, to say which host the successor boots on — asked only once a hand-off is due.
 *
 * @internal -- a part of {@link TickCadenceReads}
 */
export type ChairSuccessorRegisterRead = (args: {
  home: string;
}) => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;

/**
 * Ask the live fleet whether `cmux spawn --driver codex` would open a seat now — asked only once the register has
 * picked a Codex successor, and answered by the spawn's own decision (`../../../codex/seatDecision.ts`'s `decideCodexSeat`).
 *
 * @internal -- a part of {@link TickCadenceReads}
 */
export type ChairSuccessorCodexSeatRead = (args: { home: string }) => Promise<Result<unknown, string>>;

/**
 * Ask whether `cmux spawn --driver claude` reads the home's Claude side as unconfigured, so boots on the ambient
 * credential — asked only once the register picked an ambient Claude successor (`readClaudeFleet`).
 *
 * @internal -- a part of {@link TickCadenceReads}
 */
export type ChairSuccessorClaudeSideRead = (args: {
  home: string;
}) => Promise<Result<"configured" | "unconfigured", string>>;

/** The seams a tick judges its chair's cadence through. */
export interface TickCadenceReads {
  /** The plan register, read only for a hand-off verdict, which names the host the successor boots on. */
  readonly readPlanRegister: ChairSuccessorRegisterRead;
  /** The live Codex seat decision, read only when the register picked a Codex successor. */
  readonly readCodexSeat: ChairSuccessorCodexSeatRead;
  /** The live Claude-side read, only when the register picked an ambient Claude successor. */
  readonly readClaudeSide: ChairSuccessorClaudeSideRead;
  /** Each chair session's plan, off the credential it booted on — never telemetry's organisation. */
  readonly readChairPlans: ChairBootPlanRead;
  /** Which Claude Code each chair session runs, which one a fresh boot runs, and the newest installed. */
  readonly readClaudeCode: (options: { chair: ChairRead }) => ChairClaudeCodeReading;
  /** Each chair session's boot and the canon commits main has landed since. */
  readonly readChairCanon: ChairCanonRead;
  /** Each chair session's context fill against the auto-compact window — a reminder, never a hand-off reason. */
  readonly readChairContext: ChairContextRead;
  /** A Codex chair's canon commits since the instant its record took the chair — no rollout, no Claude registry. */
  readonly readCodexChairCanon: (options: { bootedIso: string }) => ChairCanonReading;
}

/**
 * Read each chair session's context fill, by session id.
 *
 * @internal — a field type of {@link TickCadenceReads}.
 */
export type ChairContextRead = (options: { chair: ChairRead }) => ReadonlyMap<string, ChairContextReading>;

/**
 * The cadence as one tick judged it: what the close prompt acts on when the chair could be read — a hand-off with
 * the host its successor boots on — and the lines to print either way.
 */
export type TickCadence =
  | { readonly kind: "not-judged"; readonly lines: readonly string[] }
  | { readonly kind: "judged"; readonly close: ClosePromptCadence; readonly lines: readonly string[] };

/**
 * Turn a verdict into what the lines and the close prompt render: a hand-off reads the register once, for the
 * host its successor boots on, and a Codex or ambient Claude pick is confirmed against the read the spawn itself
 * decides by; a staying chair reads nothing.
 *
 * @param verdict the cadence verdict
 * @param home the Slopweaver home whose register is read
 * @param spawnHome the `--home` the tick named, which the successor's spawn must carry; absent for the ambient one
 * @param reads the register read and the two live confirmations
 * @returns the judged cadence, its lines unprefixed
 */
async function judgedCadence({
  verdict,
  home,
  spawnHome,
  reads,
}: {
  verdict: ChairCadenceVerdict;
  home: string;
  spawnHome: string | undefined;
  reads: Pick<TickCadenceReads, "readClaudeSide" | "readCodexSeat" | "readPlanRegister">;
}): Promise<Extract<TickCadence, { kind: "judged" }>> {
  if (verdict.kind === "stay") {
    return { close: { kind: "stay" }, kind: "judged", lines: chairCadenceLines({ verdict }) };
  }
  const register = await reads.readPlanRegister({ home });
  let picked = chairSuccessorTarget({ register, route: verdict.route });
  if (picked.kind === "codex") {
    picked = codexSeatVerdict({ seat: await reads.readCodexSeat({ home }) });
  } else if (picked.kind === "claude" && ambientClaudeSuccessor({ register })) {
    picked = ambientClaudeVerdict({ claudeSide: await reads.readClaudeSide({ home }) });
  }
  const target = targetOnHome({ spawnHome, target: picked });
  return {
    close: { kind: "hand-off", target, verdict },
    kind: "judged",
    lines: chairCadenceLines({ target, verdict }),
  };
}

/**
 * Describe a thrown value without anything that can throw again: no coercion, and every read inside one guard, so a
 * hostile getter or Proxy cannot cost the tick a hand-off it already decided.
 *
 * @param error whatever the context read threw
 * @returns the thrown Error's own message when it is a string, else a fixed description
 */
function describeThrown({ error }: { error: unknown }): string {
  // Even `instanceof` runs a Proxy's trap, so the whole read sits inside the guard.
  try {
    if (!(error instanceof Error)) {
      return "a non-Error value was thrown";
    }
    const { message } = error;
    if (typeof message === "string") {
      return message;
    }
    return "an Error whose message is not a string";
  } catch {
    return "a thrown value that could not be read";
  }
}

/**
 * A Codex chair's verdict for this tick, judged on its canon alone: it never calls `readClaudeCode`, `readChairPlans`
 * or `readChairCanon`, which read a Claude tab's transcript, boot credential and registry (Codex 4c plan, property 1).
 *
 * @param evidence the gate's Codex evidence: the thread and the instant its record took the chair
 * @param reads the Codex canon read
 * @param row the tick row, for its captured gauge and its instant
 * @returns the cadence verdict
 */
function codexTickVerdict({
  evidence,
  reads,
  row,
}: {
  evidence: Extract<ChairGateEvidence, { kind: "codex" }>;
  reads: Pick<TickCadenceReads, "readCodexChairCanon">;
  row: SupervisorTickRow;
}): ChairCadenceVerdict {
  const { canonFloor } = evidence;
  const canon: ChairCanonReading =
    canonFloor.kind === "measured"
      ? reads.readCodexChairCanon({ bootedIso: canonFloor.pinnedAtIso })
      : { kind: "unmeasured", why: canonFloor.why };
  return judgeCodexChairCadence({
    canon,
    nowIso: row.finalisedIso,
    route: chairCadenceRouteOf({ gauge: cadenceGaugeOf({ gauge: row.sources.gauge }) }),
    threadId: evidence.threadId,
  });
}

/**
 * Judge the chair's hand-off cadence for this tick — advisory, and never a refusal.
 *
 * @param evidence what the chair gate read on its way past
 * @param home the Slopweaver home whose plan register names the successor's host
 * @param spawnHome the `--home` the tick named, carried onto the successor's spawn; absent for the ambient one
 * @param row the tick row, for its captured gauge and its instant
 * @param reads the chair's boot plans, Claude Code versions, loaded canon and the plan register
 * @returns what the close prompt acts on and its lines, unprefixed; `not-judged` when the gate read no chair
 */
export async function judgeTickCadence({
  evidence,
  home,
  spawnHome,
  reads,
  row,
}: {
  evidence: ChairGateEvidence;
  home: string;
  spawnHome: string | undefined;
  reads: TickCadenceReads;
  row: SupervisorTickRow;
}): Promise<TickCadence> {
  if (evidence.kind === "not-read") {
    return { kind: "not-judged", lines: [`chair cadence: not judged, so it is UNMEASURED — ${evidence.why}`] };
  }
  if (evidence.kind === "codex") {
    return judgedCadence({ home, reads, spawnHome, verdict: codexTickVerdict({ evidence, reads, row }) });
  }
  if (evidence.chair.kind === "unresolved") {
    return {
      kind: "not-judged",
      lines: [
        `chair cadence: not judged — the chair did not resolve, so its plan and Claude Code are UNMEASURED: ${evidence.chair.why}`,
      ],
    };
  }
  const versions = reads.readClaudeCode({ chair: evidence.chair });
  const canon = reads.readChairCanon({ chair: evidence.chair });
  const plans = await reads.readChairPlans({ chair: evidence.chair });
  const verdict = judgeChairCadence({
    boots: versions.boots,
    gauge: cadenceGaugeOf({ gauge: row.sources.gauge }),
    newestInstalled: versions.newestInstalled,
    nowIso: row.finalisedIso,
    sessions: chairCadenceSessions({ canon, chair: evidence.chair, plans, versions: versions.perSession }),
  });
  const judged = await judgedCadence({ home, reads, spawnHome, verdict });
  // A failed context read must never cost the tick a hand-off it already decided, so it degrades to a note.
  // The judgement sits inside the guard too: whatever the read returned is only ever touched in here, and the
  // fallback judges a Map built from this tick's own session ids.
  const sessionIds = evidence.chair.sessions.map(({ sessionId }) => sessionId);
  let context: ChairContextJudgement;
  try {
    context = judgeChairContext({ readings: reads.readChairContext({ chair: evidence.chair }), sessionIds });
  } catch (error: unknown) {
    const why = `the context read failed (${describeThrown({ error })})`;
    const unread = new Map(sessionIds.map((sessionId) => [sessionId, { kind: "unmeasured", why } as const]));
    context = judgeChairContext({ readings: unread, sessionIds });
  }
  // The reminder rides the LINES only: `close` is untouched, so a staying chair still re-arms the sweep (soft only).
  // A staying chair's lines are all notes, so its reminder leads them; a hand-off's block keeps the top.
  const reminders = context.reminders.map((line) => `chair cadence: ${line}`);
  const notes = context.notes.map((line) => `chair cadence: ${line}`);
  if (verdict.kind === "stay") {
    return { ...judged, lines: [...reminders, ...judged.lines, ...notes] };
  }
  return { ...judged, lines: [...judged.lines, ...reminders, ...notes] };
}

/**
 * The chair's hand-off cadence lines for this tick — advisory, printed and never a refusal.
 *
 * @param evidence what the chair gate read on its way past
 * @param home the Slopweaver home whose plan register names the successor's host
 * @param spawnHome the `--home` the tick named, carried onto the successor's spawn; absent for the ambient one
 * @param reads the chair's boot plans, Claude Code versions, loaded canon and the plan register
 * @param row the tick row, for its captured gauge
 * @returns the lines to print, each already prefixed
 */
export async function cadenceLines({
  evidence,
  home,
  spawnHome,
  reads,
  row,
}: {
  evidence: ChairGateEvidence;
  home: string;
  spawnHome: string | undefined;
  reads: TickCadenceReads;
  row: SupervisorTickRow;
}): Promise<readonly string[]> {
  const cadence = await judgeTickCadence({ evidence, home, reads, row, spawnHome });
  return cadence.lines.map((line) => `supervisor tick-record: ${line}`);
}
