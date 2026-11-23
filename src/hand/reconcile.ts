/**
 * TURNING THE OWNER'S CLICK INTO A ROW — the markers a running note leaves, read back into the register.
 *
 * The floating note is a separate process with no CLI of its own, so **Done** writes a marker file rather
 * than appending to the register directly. This is what converts one: every verb that reads the register
 * reconciles first, so the owner's click has landed by the time anything acts on what is open.
 *
 * ## Why a marker rather than the note running a verb
 *
 * The note would have to know where this checkout's `slopweaver` is, and a bundle that hard-codes a path to
 * a worktree stops working the moment the worktree is removed — which happens constantly here. A marker is
 * a file in a directory the note already knows, and the reconcile is ordinary reading.
 *
 * ## `later` is not `done`, and that asymmetry is the rule
 *
 * A `later` marker closes the window and says NOTHING about whether the step happened, so it is consumed and
 * no row is written. Only `done` settles. A Later on an open step is kept in the Later ledger instead
 * (`./laterPresses.ts`), so a monitor raising a lost notice again can still see the owner put it down. A register that treated a dismissed note as finished work would
 * be the "you just embarrassed me in public" failure `../live/turn/blockedOnHuman.ts` names.
 *
 * A `snooze-<choice>` marker is the note's answer in place of a bare Later: it writes no row either, and is
 * recorded with its wake instant in the snooze store (`./snoozeStore.ts`) before it is removed. The note
 * itself never writes `later` any more; the arm stays for `dismissHandNote`'s close of a settled step and for
 * any marker an older note left.
 *
 * ## A step whose row finished leaves too
 *
 * The same pass reads EVIDENCE: every open step naming a board row (`hand post --row`) is settled once that
 * row derives terminal (`./evidence.ts`), in the same append as the owner's Done presses, and its note is told to
 * close. The verbs that reconcile are `hand list`, `hand show`, `hand push` and a fired `monitor check` (the
 * supervisor's tick runs no `hand` verb, so its pass would otherwise act on a card the owner already closed) — and the console reads the
 * queue through `hand list --json`, so a finished row's card is off the owner's queue on the next poll. A row that is
 * missing or did not read whole settles nothing: it is reported, and the step stays.
 */
import { rmSync } from "node:fs";

import { type DerivedRowReadError, readDerivedRowState } from "../handover/rowState.js";
import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { donePressSettleAt } from "./donePress.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import { evidenceRetractionVerdict } from "./evidence.js";
import { rememberLaterPresses } from "./laterPresses.js";
import { appendHandSettlements } from "./multiAppend.js";
import { dismissHandNote, type NoteMarker, readNoteMarkers } from "./note/markers.js";
import { buildSettledRow, type SettledRow } from "./row.js";
import { recordSnoozePresses } from "./snoozePresses.js";
import type { SnoozeRecord } from "./snoozeStore.js";
import type { HandStep } from "./step.js";
import { readOpenHandSteps } from "./store.js";

/** What a reconcile did. */
export interface ReconcileOutcome {
  /** The ids the owner's Done button settled this pass. */
  readonly settled: readonly string[];
  /** The ids whose note the owner closed without saying it was done. */
  readonly deferred: readonly string[];
  /**
   * The ids of `done` markers this pass left on disk instead of consuming, because the register had a line
   * it could not read and the step they name might be on it. See {@link reconcileHandSteps}.
   */
  readonly held: readonly string[];
  /** The ids settled because the board row they named derived terminal. */
  readonly evidenceSettled: readonly string[];
  /** One entry per named row that was missing or did not read whole; every step naming it stayed open. */
  readonly evidenceProblems: readonly DerivedRowReadError[];
  /** One entry per evidence-settled step whose floating note could not be told to close. The settling stands. */
  readonly unclosedNotes: readonly HandStepError[];
  /** One entry per consumed marker that would not come off disk. The settling stands; the next pass meets it again. */
  readonly unremovedMarkers: readonly HandStepError[];
  /**
   * One entry per Done press whose settling would not build — a marker stamp past the account cap, say. Its
   * marker stays on disk and every other settling is still written: one bad marker used to stop the pass
   * that would have settled the rest.
   */
  readonly unsettledMarkers: readonly { readonly id: string; readonly problem: HandStepError }[];
  /** One entry per Later the ledger would not take or prune (`./laterPresses.ts`); an unrecorded one keeps its marker. */
  readonly unrecordedLaters: readonly HandStepError[];
  /** Each snooze the owner pressed on an open step that this pass recorded (`./snoozeStore.ts`). */
  readonly snoozed: readonly SnoozeRecord[];
  /**
   * One entry per snooze the store would not take or prune. A write that failed keeps its marker, so the note
   * still reads put down and the next pass records it; a press whose instant will not read is consumed, so the
   * step comes BACK to the owner's screen rather than staying away on a wake time nothing could compute.
   */
  readonly unrecordedSnoozes: readonly HandStepError[];
}

/** What a reconcile does with one marker. */
type MarkerArm = "settle" | "hold" | "defer" | "snooze" | "consume";

/**
 * What one marker gets done to it: the whole decision, with no filesystem in it.
 *
 * Pure, and its own function rather than a chain inside the loop, because the HOLD arm is the one branch
 * here whose cost is a lost click and the three-way choice is what a reader has to be able to hold. `defer`
 * and `consume` differ only in whether the id is reported: a **Later** press is a real answer the caller
 * names, while a marker for a step already settled elsewhere is housekeeping. A snooze on an open step is
 * recorded; one on a step no longer open is consumed — it only ever deferred, so it has nothing to hold.
 *
 * @param marker the one marker being classified
 * @param openIds every step id the register carries OPEN
 * @param registerReadClean whether the register read with no skipped line
 * @returns which arm this marker takes
 */
function markerDisposition({
  marker,
  openIds,
  registerReadClean,
}: {
  marker: NoteMarker;
  openIds: ReadonlySet<string>;
  registerReadClean: boolean;
}): MarkerArm {
  if (marker.answer === "later") {
    return "defer";
  }
  if (marker.answer === "snooze") {
    return openIds.has(marker.id) ? "snooze" : "consume";
  }
  if (openIds.has(marker.id)) {
    return "settle";
  }
  if (!registerReadClean) {
    return "hold";
  }
  return "consume";
}

/**
 * Every marker sorted into its arm, in one pure pass.
 *
 * The whole classification happens before anything is written or removed, which is what lets the shell below
 * write every settling row FIRST and only then remove any marker file. Interleaved, an append that failed
 * halfway left earlier markers already deleted and their rows written — a partial pass nothing recorded.
 *
 * @param markers every marker on disk, in id order
 * @param openIds every step id the register carries OPEN
 * @param registerReadClean whether the register read with no skipped line
 * @returns the five arms, each in the order the markers arrived
 */
function groupMarkers({
  markers,
  openIds,
  registerReadClean,
}: {
  markers: readonly NoteMarker[];
  openIds: ReadonlySet<string>;
  registerReadClean: boolean;
}): Readonly<Record<MarkerArm, readonly NoteMarker[]>> {
  const arms: Record<MarkerArm, NoteMarker[]> = {
    consume: [],
    defer: [],
    hold: [],
    settle: [],
    snooze: [],
  };
  for (const marker of markers) {
    arms[markerDisposition({ marker, openIds, registerReadClean })].push(marker);
  }
  return arms;
}

/**
 * The settlings evidence owes this pass: one per open step whose named row now derives terminal, and one
 * problem per named row that could not be read. Each distinct row is read ONCE, however many steps name it.
 *
 * @param steps the open steps, less any a Done press is already settling
 * @param handoverDir the board's directory
 * @param runsDir the run-journal directory
 * @param nowIso the settling instant
 * @param bySession which session is reconciling
 * @returns the settlings to write and the rows that could not be read
 */
function evidenceSettlements({
  steps,
  handoverDir,
  runsDir,
  nowIso,
  bySession,
}: {
  steps: readonly HandStep[];
  handoverDir: string;
  runsDir: string;
  nowIso: string;
  bySession: string;
}): Result<{ rows: readonly SettledRow[]; problems: readonly DerivedRowReadError[] }, HandStepError> {
  const statuses = new Map<string, ReturnType<typeof readDerivedRowState>>();
  const rows: SettledRow[] = [];
  for (const step of steps) {
    if (step.row === undefined) {
      continue;
    }
    let read = statuses.get(step.row);
    if (read === undefined) {
      read = readDerivedRowState({ handoverDir, runsDir, slug: step.row });
      statuses.set(step.row, read);
    }
    if (read.isErr()) {
      continue;
    }
    const verdict = evidenceRetractionVerdict({ status: read.value.status, step });
    if (verdict.kind === "keep") {
      continue;
    }
    const built = buildSettledRow({ draft: { bySession, did: verdict.did, id: step.id, settledIso: nowIso } });
    if (built.isErr()) {
      return err(built.error);
    }
    rows.push(built.value);
  }
  const problems = [...statuses.values()].flatMap((read) => (read.isErr() ? [read.error] : []));
  return ok({ problems, rows });
}

/**
 * The settlings the owner's Done presses make, one per marker, and the presses whose settling would not build.
 *
 * A press that will not build keeps its marker and is named rather than failing the pass: one bad marker used
 * to stop the append that would have recorded every other press and every evidence retraction with it.
 *
 * @param markers the `done` markers whose step is open
 * @param bySession which session is reconciling, recorded as provenance
 * @param nowIso this reconcile's instant, which a press with no readable stamp settles at
 * @returns the rows to write with the markers they consume, and each press that would not record
 */
function doneSettlements({
  markers,
  bySession,
  nowIso,
}: {
  markers: readonly NoteMarker[];
  bySession: string;
  nowIso: string;
}): {
  doneRows: readonly SettledRow[];
  doneMarkers: readonly NoteMarker[];
  unsettledMarkers: readonly { id: string; problem: HandStepError }[];
} {
  const doneRows: SettledRow[] = [];
  const doneMarkers: NoteMarker[] = [];
  const unsettledMarkers: { id: string; problem: HandStepError }[] = [];
  for (const marker of markers) {
    const built = donePressSettleAt({ nowIso, path: marker.path }).andThen((press) =>
      buildSettledRow({ draft: { bySession, id: marker.id, ...press } }),
    );
    if (built.isErr()) {
      unsettledMarkers.push({ id: marker.id, problem: built.error });
      continue;
    }
    doneRows.push(built.value);
    doneMarkers.push(marker);
  }
  return { doneMarkers, doneRows, unsettledMarkers };
}

/**
 * What a pass does once its append has landed: remove the markers it consumed, then tell each evidence-settled
 * step's floating note to close.
 *
 * Only once every row is written: a marker removed before its append succeeded is a click nothing recorded.
 * The notes close after the append, and never fatally: the register is what every surface reads, so a note
 * that would not close is reported beside a settling that already stands, rather than failing the list that
 * shows the owner their queue.
 *
 * A Later press on an open step is written to the Later ledger first (`./laterPresses.ts`), and one that would not
 * record keeps its marker, so the note still reads dismissed and the next pass records it.
 *
 * @param markers the Done markers this pass consumed, pressed or dropped
 * @param laters the `later` markers this pass consumes once each is remembered
 * @param snoozes the snooze markers this pass consumes once each is recorded
 * @param open the register's open read, which a Later must name and whose skipped lines stop the ledger pruning
 * @param retracted the steps evidence settled this pass
 * @param nowIso the instant each close is stamped at
 * A marker that will not come off disk — a directory under a marker's name, a permission — is reported rather
 * than thrown: the settling it recorded already stands.
 *
 * @returns one error per marker that stayed, per note that would not close and per Later or snooze that would
 *   not record, and each snooze recorded
 */
function afterAppend({
  home,
  markers,
  laters,
  snoozes,
  open,
  retracted,
  nowIso,
}: {
  home: string;
  markers: readonly NoteMarker[];
  laters: readonly NoteMarker[];
  snoozes: readonly NoteMarker[];
  open: { readonly steps: readonly HandStep[]; readonly unparsed: readonly unknown[] };
  retracted: readonly string[];
  nowIso: string;
}): {
  unclosedNotes: HandStepError[];
  unrecordedLaters: readonly HandStepError[];
  unremovedMarkers: HandStepError[];
  snoozed: readonly SnoozeRecord[];
  unrecordedSnoozes: readonly HandStepError[];
} {
  const openIds = new Set(open.steps.map((step) => step.id));
  const remembered = rememberLaterPresses({
    home,
    nowIso,
    open: openIds,
    pressed: laters.map((marker) => marker.id),
    prune: open.unparsed.length === 0,
  });
  const slept = recordSnoozePresses({ home, open: openIds, prune: open.unparsed.length === 0, snoozes });
  const consumed = [...markers, ...laters.filter((marker) => !remembered.unrecorded.has(marker.id)), ...slept.consumed];
  const unremovedMarkers = consumed.flatMap((marker) => {
    try {
      rmSync(marker.path, { force: true });
      return [];
    } catch (cause) {
      return [HandStepErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path: marker.path })];
    }
  });
  const unclosedNotes = retracted.flatMap((id) =>
    dismissHandNote({ home, id, nowIso }).match(
      () => [],
      (problem) => [problem],
    ),
  );
  return {
    snoozed: slept.snoozed,
    unclosedNotes,
    unrecordedLaters: remembered.problems,
    unrecordedSnoozes: slept.problems,
    unremovedMarkers,
  };
}

/**
 * Read every marker the note left and every row an open step names; settle what the owner pressed Done on and what
 * its row finished, and consume the rest.
 *
 * A marker naming a step the register does not carry open is consumed and skipped rather than refused: a
 * step settled by `hand done` in a terminal while its note was still up leaves exactly that, and it is not
 * an error in any sense a caller could act on.
 *
 * **Unless the read SKIPPED a line, in which case a `done` marker is HELD rather than consumed.** A line
 * the reader cannot parse is skipped instead of refusing the whole register
 * (`./store.ts`), and "no open step carries this id" stops being conclusive: the posting might be on the
 * skipped line. Consuming the marker there would throw away a press of **Done** — the one thing in this
 * module that cannot be recovered, because nothing else records that the owner clicked. So the marker stays on
 * disk and the same reconcile settles it once the register reads clean. The cost is a note that may close
 * and reopen; the cost of the other choice is the owner's click, silently.
 *
 * Every settling — the owner's and evidence's — is written by ONE lock-held append, and only then are markers
 * consumed and the evidence-settled steps' notes told to close.
 *
 * @param home the state home
 * @param nowIso the instant the settling rows are written at
 * @param bySession which session is reconciling, recorded as provenance
 * @returns what was settled, deferred, held and retracted by evidence, or the failure
 */
export function reconcileHandSteps({
  home,
  nowIso,
  bySession,
}: {
  home: string;
  nowIso: string;
  bySession: string;
}): Result<ReconcileOutcome, HandStepError> {
  const paths = stateHomePaths({ home });
  const markers = readNoteMarkers({ markerDir: paths.handNoteDismiss });
  if (markers.isErr()) {
    return err(markers.error);
  }
  const open = readOpenHandSteps({ home });
  if (open.isErr()) {
    return err(open.error);
  }
  const grouped = groupMarkers({
    markers: markers.value,
    openIds: new Set(open.value.steps.map((step) => step.id)),
    registerReadClean: open.value.unparsed.length === 0,
  });
  const { doneMarkers, doneRows, unsettledMarkers } = doneSettlements({ bySession, markers: grouped.settle, nowIso });
  const pressed = new Set(doneMarkers.map((marker) => marker.id));
  const evidence = evidenceSettlements({
    bySession,
    handoverDir: paths.handovers,
    nowIso,
    runsDir: paths.runs,
    steps: open.value.steps.filter((step) => !pressed.has(step.id)),
  });
  if (evidence.isErr()) {
    return err(evidence.error);
  }
  const written = appendHandSettlements({ home, nowIso, rows: [...doneRows, ...evidence.value.rows] });
  if (written.isErr()) {
    return err(written.error);
  }
  const wrote = new Set(written.value.ids);
  const retracted = evidence.value.rows.map((row) => row.id).filter((id) => wrote.has(id));
  const after = afterAppend({
    home,
    laters: grouped.defer,
    markers: [...doneMarkers, ...grouped.consume],
    nowIso,
    open: open.value,
    retracted,
    snoozes: grouped.snooze,
  });
  return ok({
    ...after,
    deferred: grouped.defer.map((marker) => marker.id),
    evidenceProblems: evidence.value.problems,
    evidenceSettled: retracted,
    held: grouped.hold.map((marker) => marker.id),
    settled: doneMarkers.map((marker) => marker.id),
    unsettledMarkers,
  });
}
