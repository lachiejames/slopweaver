/**
 * THE ESCALATION STAGE — after a fired pass, every "When it gets worse" hold (`./escalationHolds.ts`) is judged
 * against what the pass just read: a pending hold takes its baseline, a subject read STRICTLY worse brings its note
 * back and forgets the hold, and a subject no longer read firing forgets it.
 *
 * {@link judgeEscalation} decides; {@link runEscalationStage} reads, writes and raises. A hold is only ever judged by
 * a reading of its own monitor: a pass that did not run that monitor, or read it unmeasurable or steered, leaves it
 * exactly where it was.
 */
import { isDeepStrictEqual } from "node:util";

import { ok } from "#lib/result.js";

import type { HandStep } from "../hand/step.js";
import { readOpenHandSteps } from "../hand/store.js";

import type { MonitorError } from "./errors.js";
import {
  type EscalationHold,
  forgetEscalationHold,
  readEscalationHolds,
  recordEscalationHold,
} from "./escalationHolds.js";
import { isWorse, worsenMeasure } from "./noteAnswers.js";
import { kindMuted } from "./noteMutes.js";
import { monitorNoteLevel, type NoteRaiser } from "./passPost.js";
import type { PassAction } from "./passSettle.js";
import { handStepId, monitorDefinition, occurrenceBase, occurrenceNumber } from "./registry.js";
import type { MonitorReading } from "./types.js";

/** What one hold comes to on one pass. */
export type EscalationDecision =
  | { readonly kind: "keep" }
  | { readonly kind: "forget"; readonly why: string }
  | { readonly kind: "measure"; readonly baseline: number }
  | { readonly kind: "worse"; readonly baseline: number; readonly measure: number };

/**
 * Judge one hold against this pass's reading of its monitor.
 *
 * A clear reading, or a complete firing one that no longer carries the subject, forgets the hold: the thing it held
 * is gone, and a later return is a fresh card whose note raises as any arrival does. A firing reading with a blind
 * spot that misses the subject keeps it, since a subject missing from a partial read was never observed clearing.
 *
 * @param hold the "when it gets worse" answer being judged, pending or held against its baseline
 * @param reading this pass's reading of the hold's monitor, or undefined when the pass did not run it
 * @returns what the hold comes to
 */
export function judgeEscalation({
  hold,
  reading,
}: {
  hold: EscalationHold;
  reading: MonitorReading | undefined;
}): EscalationDecision {
  if (reading === undefined || reading.state === "steered" || reading.state === "unmeasurable") {
    return { kind: "keep" };
  }
  if (reading.state === "clear") {
    return { kind: "forget", why: "the monitor reads clear" };
  }
  const definition = monitorDefinition({ monitorId: hold.monitorId });
  const subject = reading.subjects.find(
    (candidate) => handStepId({ prefix: definition.prefix, subject: candidate }) === hold.base,
  );
  if (subject === undefined) {
    return reading.blindSpot === undefined
      ? { kind: "forget", why: "the subject is no longer read firing" }
      : { kind: "keep" };
  }
  const measure = worsenMeasure({ definition, subject });
  if (measure === undefined || definition.worsens === undefined) {
    return { kind: "keep" };
  }
  if (hold.state.kind === "pending") {
    return { baseline: measure, kind: "measure" };
  }
  const { baseline } = hold.state;
  if (isWorse({ baseline, direction: definition.worsens.direction, measure })) {
    return { baseline, kind: "worse", measure };
  }
  return { kind: "keep" };
}

/**
 * Judge every hold against a fired pass's readings, and act: record a baseline, forget a hold, or raise the note of
 * the subject's newest open card and forget the hold once it came up. A raise that fails keeps the hold, so the next
 * pass reads it worse again and retries. A raise that LAUNCHED counts as up, exactly as an arrival's raise does: a
 * panel that dies after its launch is the raise contract's residue, not this hold's, and no heartbeat is awaited.
 *
 * @param home the state home
 * @param readings what the pass read, one per monitor it ran
 * @param open every step the register carries open AFTER the pass posted
 * @param nowIso the instant a baseline is recorded at
 * @param raiseNote the raw raiser — not the gated one, since getting worse is exactly what this hold waited for
 * @param stillHeld the fired-pass lease's fence, asked before each hold's writes, as `./pass.ts` asks before each
 * reading's: once it answers false the stage stops, and every hold not yet judged stays exactly where it was
 * @returns a row per hold that moved, every store failure met, and whether the fence stopped the stage
 */
export function runEscalationStage({
  home,
  readings,
  open,
  nowIso,
  raiseNote,
  stillHeld,
}: {
  home: string;
  readings: readonly MonitorReading[];
  open: readonly HandStep[];
  nowIso: string;
  raiseNote: NoteRaiser;
  stillHeld: () => boolean;
}): { actions: readonly PassAction[]; fenced: boolean; problems: readonly MonitorError[] } {
  const read = readEscalationHolds({ home });
  const actions: PassAction[] = [];
  const problems: MonitorError[] = [...read.problems];
  for (const hold of read.records) {
    if (!stillHeld()) {
      return { actions, fenced: true, problems };
    }
    if (!holdStillCurrent({ home, hold, problems })) {
      continue;
    }
    const decision = judgeEscalation({
      hold,
      reading: readings.find((reading) => reading.monitorId === hold.monitorId),
    });
    // The note's launch takes real time: the lease, or the owner's answer, may move during it, so the forget asks again.
    const settles = (): boolean => stillHeld() && holdStillCurrent({ home, hold, problems });
    actions.push(...actOnDecision({ decision, hold, home, nowIso, open, problems, raiseNote, settles }));
  }
  return { actions, fenced: false, problems };
}

/**
 * The stage over a fired pass, judged against the register as it stands AFTER the pass, so a card the pass just
 * re-cut is the one whose note comes back. Every failure is a diagnostic line, and reported as `faulted`: a hold the
 * stage could not move may still keep a note down, so the verb that ran it exits 1.
 *
 * A pass that lost its fired-pass lease judges nothing: its readings predate whatever the pass that took over
 * recorded, so judging them against that pass's baseline could raise a note on a reading older than the baseline.
 *
 * @param home the state home
 * @param nowIso the instant a baseline is recorded at
 * @param raiseNote the RAW raiser, never the gated one
 * @param readings the fired pass's readings, which judge every hold
 * @param stillHeld whether this pass still holds the fired-pass lease, asked before anything is read and again
 * before each hold's writes
 * @param writeDiagnostic where a register or store failure is named
 * @returns one row per hold that moved, and whether a register or store failure was met
 */
export function runFiredEscalations({
  home,
  nowIso,
  raiseNote,
  readings,
  stillHeld,
  writeDiagnostic,
}: {
  home: string;
  nowIso: string;
  raiseNote: NoteRaiser;
  readings: readonly MonitorReading[];
  stillHeld: () => boolean;
  writeDiagnostic: (line: string) => void;
}): { readonly actions: readonly PassAction[]; readonly faulted: boolean } {
  if (!stillHeld()) {
    writeDiagnostic("monitor check: escalation holds not judged — another fired pass took the lease");
    return { actions: [], faulted: false };
  }
  const open = readOpenHandSteps({ home });
  if (open.isErr()) {
    writeDiagnostic(`monitor check: escalation holds not judged — ${open.error.message}`);
    return { actions: [], faulted: true };
  }
  const staged = runEscalationStage({ home, nowIso, open: open.value.steps, raiseNote, readings, stillHeld });
  for (const problem of staged.problems) {
    writeDiagnostic(`monitor check: ${problem.message}`);
  }
  if (staged.fenced) {
    writeDiagnostic("monitor check: escalation holds not all judged — another fired pass took the lease mid-stage");
  }
  return { actions: staged.actions, faulted: staged.problems.length > 0 };
}

/**
 * Whether the hold read at the stage's start is still the one on disk. A press consumed while the stage ran (`hand
 * push`, `hand wake` and `hand show` record them too) replaces a subject's hold with a fresh pending one, and judging
 * the stale snapshot would raise against a baseline the owner has since re-answered and then forget their newer answer. A
 * replaced or removed hold is skipped here and judged by the next pass.
 *
 * @param hold the snapshot the stage is about to judge
 * @param problems where every failure of this reread is collected once — a hold it could not read again may still
 * stand, so it is named rather than skipped in silence
 * @returns true when the record under its base reads exactly as the snapshot does
 */
function holdStillCurrent({
  home,
  hold,
  problems,
}: {
  home: string;
  hold: EscalationHold;
  problems: MonitorError[];
}): boolean {
  const read = readEscalationHolds({ home });
  // Every failure this reread meets is kept, the current hold readable or not: a record that turned unreadable since
  // the stage's snapshot — one this loop will never visit — still keeps its note down. Each is named once.
  read.problems
    .filter((problem) => !problems.some((known) => known.message === problem.message))
    .forEach((problem) => {
      problems.push(problem);
    });
  const current = read.records.find((record) => record.base === hold.base);
  if (current === undefined) {
    return false;
  }
  return isDeepStrictEqual(current, hold);
}

/**
 * Carry out one hold's decision: record its baseline, forget it, or raise its note.
 *
 * @param decision what {@link judgeEscalation} made of the hold on this pass
 * @param hold the hold
 * @param nowIso the instant a baseline is recorded at
 * @param open every open step, the subject's newest card among them
 * @param problems where a store failure is collected
 * @param raiseNote the raw raiser
 * @param settles whether a raised note may still forget the hold: the lease held, and the owner's answer unchanged
 * @returns the rows the hold moved by, none when it only took a baseline or stayed put
 */
function actOnDecision({
  decision,
  hold,
  home,
  nowIso,
  open,
  problems,
  raiseNote,
  settles,
}: {
  decision: EscalationDecision;
  hold: EscalationHold;
  home: string;
  nowIso: string;
  open: readonly HandStep[];
  problems: MonitorError[];
  raiseNote: NoteRaiser;
  settles: () => boolean;
}): readonly PassAction[] {
  const row = ({ kind, detail }: { kind: PassAction["kind"]; detail: string }): PassAction => ({
    detail,
    kind,
    monitorId: hold.monitorId,
    stepId: hold.base,
  });
  if (decision.kind === "keep") {
    return [];
  }
  if (decision.kind === "measure") {
    const written = recordEscalationHold({
      hold: { ...hold, state: { baseline: decision.baseline, kind: "holding", measuredIso: nowIso } },
      home,
    });
    if (written.isErr()) {
      problems.push(written.error);
    }
    return [];
  }
  if (decision.kind === "forget") {
    const forgotten = forgetEscalationHold({ base: hold.base, home });
    if (forgotten.isErr()) {
      problems.push(forgotten.error);
      return [];
    }
    return [row({ detail: `the "when it gets worse" hold is forgotten: ${decision.why}`, kind: "settled" })];
  }
  return raiseWorse({ decision, home, hold, open, problems, raiseNote, row, settles });
}

/**
 * Raise a held subject's note now that it reads worse, and forget the hold once it came up.
 *
 * @param decision the worse reading, for the row's numbers
 * @param hold the hold
 * @param open every open step, the subject's newest card among them
 * @param problems where a store failure is collected
 * @param row a row about this hold
 * @param settles asked once the note is up: false leaves the hold for the pass that holds the lease, or for the owner's
 * newer answer
 * @returns the note's row
 */
function raiseWorse({
  decision,
  home,
  hold,
  open,
  problems,
  raiseNote,
  row,
  settles,
}: {
  decision: { readonly baseline: number; readonly measure: number };
  home: string;
  hold: EscalationHold;
  open: readonly HandStep[];
  problems: MonitorError[];
  raiseNote: NoteRaiser;
  row: (options: { kind: PassAction["kind"]; detail: string }) => PassAction;
  settles: () => boolean;
}): readonly PassAction[] {
  const definition = monitorDefinition({ monitorId: hold.monitorId });
  const unit = definition.worsens === undefined ? "" : ` ${definition.worsens.unit}`;
  const step = open
    .filter((candidate) => occurrenceBase({ id: candidate.id }) === hold.base)
    .toSorted((a, b) => occurrenceNumber({ id: b.id }) - occurrenceNumber({ id: a.id }))[0];
  if (step === undefined) {
    const forgotten = forgetEscalationHold({ base: hold.base, home });
    if (forgotten.isErr()) {
      problems.push(forgotten.error);
      return [];
    }
    return [row({ detail: "it read worse, but no card for it is open — the hold is forgotten", kind: "settled" })];
  }
  // The owner's mute of the whole kind is the wider answer: the note stays down, and the hold it covers is forgotten.
  if (kindMuted({ home, monitorId: hold.monitorId })) {
    const forgotten = forgetEscalationHold({ base: hold.base, home });
    if (forgotten.isErr()) {
      problems.push(forgotten.error);
      return [];
    }
    return [
      row({
        detail: `it read worse, but you muted ${hold.monitorId}'s note — no note comes up, the hold is forgotten; the card stands`,
        kind: "settled",
      }),
    ];
  }
  const raised = raiseNote({ level: monitorNoteLevel({ definition }), step });
  if (raised.isErr()) {
    return [row({ detail: `it read worse, but the floating note did not come up: ${raised.error}`, kind: "refused" })];
  }
  const forgotten = settles() ? forgetEscalationHold({ base: hold.base, home }) : ok(false);
  if (forgotten.isErr()) {
    problems.push(forgotten.error);
  }
  const moved = `${String(decision.baseline)} → ${String(decision.measure)}${unit}`;
  return [{ ...row({ detail: `it got worse (${moved}): ${raised.value}`, kind: "noted" }), stepId: step.id }];
}
