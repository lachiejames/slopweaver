/**
 * The register's two writers that record MORE THAN ONE ROW under one lock: a re-cut (a new posting and the
 * settling of the step it replaces, on one line) and a batch of settlings (what a reconcile pass writes).
 *
 * Each is one read-check-append through `./store.ts`'s `underLock`, and each checks every row before a byte is
 * written, so a reader never sees half of one. The single-row append stays in `./store.ts` and every rule a posting
 * meets in `./postingChecks.ts`; this module adds only what a second row in the same append changes.
 */
import { slopweaverHome } from "../homeDir.js";
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { type PlanEmail, readPlanEmails } from "./planSignIn.js";
import { postingOrRowRefusal, skippedLines } from "./postingChecks.js";
import { buildSettledRow, type HandRow, isSettledRow, openHandSteps, type SettledRow } from "./row.js";
import type { HandStep } from "./step.js";
import {
  alreadyHeld,
  appendHandRow,
  appendText,
  type HandAppendReceipt,
  handRegisterPath,
  type RowAdmission,
  readBackOf,
  readHandRows,
  rowAdmissionRefusal,
  serialised,
  underLock,
  unreadBesideTornTail,
} from "./store.js";

/** What posting a step did, and which open step it replaced. */
export interface HandPostReceipt extends HandAppendReceipt {
  /** The id this posting superseded in the same append, or `undefined` when it replaced nothing. */
  readonly superseded: string | undefined;
}

/**
 * Post one step, and when it is a RE-CUT settle the step it supersedes in the same lock-held append.
 *
 * A session re-cutting one card as another in two commands — post the new, retract the old —
 * has nothing tying the two together, so for the gap between them the owner's queue carries both. Here the new
 * posting and the old step's settling (`superseded by <new id>`) are validated together under one lock and
 * written as ONE line, the settling riding the posting (`./row.ts`'s `rowsOfLine`). Two lines in one append were
 * not enough: a crash between them left both cards up with nothing to finish the job. A
 * line cut short is one torn row, dropped by the next append, so the register reads the re-cut whole or not at all.
 * The same settling follows as a plain line of its own, for a reader built before the field; to such a reader a
 * crash between the two lines leaves both cards, exactly as a two-line re-cut always did.
 *
 * With no `supersedes` this is exactly `./store.ts`'s `appendHandRow` for a posting.
 *
 * @param step the validated step
 * @param supersedes the open step it replaces, when it is a re-cut
 * @param nowIso the instant the lock is taken and the settling is stamped at
 * @param home the state home (defaults to the resolved home)
 * @param admitRow what a write opening a new row-backed card must pass, judged under the lock
 * @returns what was written and what it replaced, or the failure — and nothing written on a failure
 */
export async function appendHandPost({
  step,
  supersedes,
  nowIso,
  home = slopweaverHome(),
  admitRow,
}: {
  step: HandStep;
  supersedes: string | undefined;
  nowIso: string;
  home?: string;
  admitRow?: RowAdmission | undefined;
}): Promise<Result<HandPostReceipt, HandStepError>> {
  if (supersedes === undefined) {
    const posted = await appendHandRow({ admitRow, home, nowIso, row: { kind: "posted", step } });
    return posted.map((receipt) => ({ ...receipt, superseded: undefined }));
  }
  if (supersedes === step.id) {
    return err(HandStepErrors.invalidField({ field: "supersedes", why: `names ${step.id}, the step being posted` }));
  }
  const settling = buildSettledRow({
    draft: { bySession: step.postedBy, did: `superseded by ${step.id}`, id: supersedes, settledIso: nowIso },
  });
  if (settling.isErr()) {
    return err(settling.error);
  }
  const plans = await readPlanEmails({ home });
  return underLock({
    home,
    nowIso,
    section: (path) => supersedeUnderLock({ admitRow, path, plans, settled: settling.value, step }),
  });
}

/** The line a re-cut appends, the settling alone a two-line one an earlier build tore still owes, and what they read as. */
interface RecutLines {
  readonly recut: string;
  readonly settling: string;
  readonly step: HandStep;
  readonly oldId: string;
}

/**
 * Both lines serialised once and read back as the register's own reader reads them, so every check runs on the
 * bytes that will be appended rather than on the objects offered.
 *
 * @param step the new posting's step
 * @param settled the old step's settling
 * @returns the lines and what they read back as, or the reader's refusal
 */
function recutLines({ step, settled }: { step: HandStep; settled: SettledRow }): Result<RecutLines, HandStepError> {
  const recut = serialised({ row: { kind: "posted", settles: settled, step } });
  const settling = serialised({ row: settled });
  const recutRow = readBackOf({ line: recut });
  if (recutRow.isErr()) {
    return err(recutRow.error);
  }
  const settlingRow = readBackOf({ line: settling });
  if (settlingRow.isErr()) {
    return err(settlingRow.error);
  }
  if (isSettledRow(recutRow.value) || recutRow.value.settles === undefined || !isSettledRow(settlingRow.value)) {
    return err(HandStepErrors.unwritableRow({ why: "a re-cut is one posting carrying one settling" }));
  }
  return ok({ oldId: recutRow.value.settles.id, recut, settling, step: recutRow.value.step });
}

/**
 * What a re-cut still has to write: the one line, the plain settling alone a posting on disk without it still owes — a
 * two-line re-cut an earlier build tore between its lines, or a one-line re-cut torn before its trailing settling — or
 * nothing. A settling-only plan names the settling it writes: the one the landed re-cut line carries when there is
 * one, so the plain line repeats it rather than restamping it at the retry's instant.
 */
type RecutPlan =
  | { readonly kind: "both" }
  | { readonly kind: "settling-only"; readonly settling: SettledRow | undefined }
  | { readonly kind: "already-whole" };

/**
 * What a re-cut writes against the register as it stands, or why it may not — pure, over rows already read.
 *
 * An exact retry — the new step already recorded and the old one already settled — is the idempotent no-op a
 * single posting's retry is. A retry over a posting on disk whose settling never landed writes the settling alone.
 *
 * @param rows the register as read under the lock
 * @param unparsed the lines that read skipped
 * @param step the new posting, as read back
 * @param oldId the step it replaces
 * @param plans every registered plan's alias and cached address, for a sign-in naming one
 * @returns the plan, or the refusal
 */
function recutPlan({
  rows,
  unparsed,
  step,
  oldId,
  plans,
}: {
  rows: readonly HandRow[];
  unparsed: readonly HandStepError[];
  step: HandStep;
  oldId: string;
  plans: readonly PlanEmail[];
}): Result<RecutPlan, HandStepError> {
  const duplicate = alreadyHeld({ row: asRetryOf({ rows, step }), rows });
  if (duplicate.isErr()) {
    return err(duplicate.error);
  }
  const open = openHandSteps({ rows });
  const oldStep = open.find((held) => held.id === oldId);
  if (oldStep === undefined) {
    return retriedPlan({ duplicate: duplicate.value, newId: step.id, oldId, rows });
  }
  // A re-cut keeps its row, in both directions. Dropping one is how a card loses the only evidence that could
  // ever take it down; ADDING one leaves a cut-short re-cut's old, rowless half where evidence never
  // reaches it once the row finishes.
  if (step.row !== oldStep.row) {
    return err(
      HandStepErrors.invalidField({
        field: "row",
        why: `must stay ${postingFormOf({ row: oldStep.row })}, as ${oldId} has it — a re-cut replaces the card, not the work it waits on. Retract it and post afresh if the work changed`,
      }),
    );
  }
  // A new id the register already holds a settling for is a used id, never the landed half of a cut-short re-cut:
  // any settling closes the id for good, so the old step would be settled with no card up at all
  // — whether or not a posting of it is on disk.
  if (rows.some((row) => isSettledRow(row) && row.id === step.id)) {
    return err(
      HandStepErrors.invalidField({
        field: "id",
        why: `${step.id} was posted and settled before — a re-cut needs a fresh id`,
      }),
    );
  }
  const refusal = postingOrRowRefusal({ plans, replacing: oldId, rows, step, unparsed });
  if (refusal.isErr()) {
    return err(refusal.error);
  }
  // A posting on disk with the old step still open is a two-line re-cut torn between its lines: it carries no
  // settling, so the one this call built is the one owed. One that carries a settling re-cut a DIFFERENT step,
  // and adopting it would leave no re-cut line carrying this one's.
  if (duplicate.value) {
    if (rows.some((row) => row.kind === "posted" && row.step.id === step.id && row.settles !== undefined)) {
      return err(HandStepErrors.stepIdConflict({ field: "supersedes", id: step.id }));
    }
    return ok({ kind: "settling-only", settling: undefined });
  }
  return ok({ kind: "both" });
}

/**
 * What a retry of a re-cut whose old step is no longer open still owes: nothing once the plain settling after the
 * one-line re-cut is on disk, that plain settling alone when only the re-cut line landed, or a refusal when no posting
 * of this re-cut is on disk at all.
 *
 * The plain settling is told apart from the one the re-cut line carries by IDENTITY: `./row.ts`'s `rowsOfLine`
 * expands a line into the posting and that posting's own `settles` object, so a settled row that is some posting's
 * `settles` came off the re-cut line, and any other came off a line of its own. Without it a crash at the re-cut
 * line's end, or inside the trailing settling, retried as a no-op and left a reader built before `settles` showing
 * both cards.
 *
 * A retry counts only over THIS re-cut on disk: a posting of the new id carrying the old step's settling, or a plain
 * settling of the old step saying it was superseded by the new id (the two-line form an earlier build wrote). An
 * equal posting beside a settling that closed the old step for some other reason is no re-cut at all.
 *
 * @param rows the register as read, never copied, so identity still says which line a settling came off
 * @param duplicate whether a posting equal to the offered one is already on disk
 * @param oldId the step the re-cut supersedes
 * @param newId the step the re-cut posts
 * @returns the plan, or the refusal naming the step that is not open
 */
function retriedPlan({
  rows,
  duplicate,
  oldId,
  newId,
}: {
  rows: readonly HandRow[];
  duplicate: boolean;
  oldId: string;
  newId: string;
}): Result<RecutPlan, HandStepError> {
  const settlings = rows.filter((row): row is SettledRow => isSettledRow(row) && row.id === oldId);
  const carriedByRecut = rows.flatMap((row) =>
    row.kind === "posted" && row.step.id === newId && row.settles?.id === oldId ? [row.settles] : [],
  )[0];
  const twoLine = settlings.some((row) => row.did === `superseded by ${newId}`);
  if (!duplicate || (carriedByRecut === undefined && !twoLine)) {
    return err(HandStepErrors.unknownStep({ id: oldId }));
  }
  const carried = new Set<HandRow>(
    rows.flatMap((row) => (row.kind === "posted" && row.settles !== undefined ? [row.settles] : [])),
  );
  if (settlings.some((row) => !carried.has(row))) {
    return ok({ kind: "already-whole" });
  }
  return ok({ kind: "settling-only", settling: carriedByRecut });
}

/**
 * The re-cut's critical section: its lines read back, the register read whole, the plan, then one append.
 *
 * @param admitRow what the write must pass when it opens the new card
 * @param path the register file
 * @param plans every registered plan's alias and cached address, read before the lock
 * @param step the new posting's step
 * @param settled the old step's settling
 * @returns what was written, or the failure
 */
function supersedeUnderLock({
  admitRow,
  path,
  plans,
  settled,
  step: offered,
}: {
  admitRow: RowAdmission | undefined;
  path: string;
  plans: readonly PlanEmail[];
  settled: SettledRow;
  step: HandStep;
}): Result<HandPostReceipt, HandStepError> {
  const lines = recutLines({ settled, step: offered });
  if (lines.isErr()) {
    return err(lines.error);
  }
  const { oldId, recut, settling, step } = lines.value;
  const read = wholeRegister({ path });
  if (read.isErr()) {
    return err(read.error);
  }
  const { rows, unparsed } = read.value;
  const plan = recutPlan({ oldId, plans, rows, step, unparsed });
  if (plan.isErr()) {
    return err(plan.error);
  }
  // Only a write that opens the new card meets the row: finishing a cut-short re-cut opens none.
  if (plan.value.kind === "both") {
    const refusedRow = rowAdmissionRefusal({ admitRow, step });
    if (refusedRow.isErr()) {
      return err(refusedRow.error);
    }
  }
  const receipt = { appended: plan.value.kind === "both", id: step.id, path, superseded: oldId, unparsed };
  // A call that writes nothing touches nothing, a torn tail included: the next append drops it.
  if (plan.value.kind === "already-whole") {
    return ok({ ...receipt, droppedTornBytes: 0 });
  }
  // The plain settling follows for a reader built before `settles`, which folds one row per line and ignores it
  // To this reader it is a second settling of a settled id, which changes nothing.
  let text = `${recut}\n${settling}\n`;
  if (plan.value.kind === "settling-only") {
    text = `${plan.value.settling === undefined ? settling : serialised({ row: plan.value.settling })}\n`;
  }
  return appendText({ path, text }).map((droppedTornBytes) => ({ ...receipt, droppedTornBytes }));
}

/**
 * The register read whole for a re-cut — every row, with no line unread but a torn tail the append will drop.
 *
 * An unread line refuses because it may be the very step being superseded. A torn tail cannot be: it is an
 * interrupted write's fragment, this re-cut's own included, and leaving it to refuse kept both cards up for good
 * `./store.ts`'s `unreadBesideTornTail` sets it aside; `appendText` drops it.
 *
 * @param path the register file
 * @returns every row, or the refusal an unread line makes
 */
function wholeRegister({
  path,
}: {
  path: string;
}): Result<{ rows: readonly HandRow[]; unparsed: readonly HandStepError[] }, HandStepError> {
  const held = readHandRows({ missing: "empty", path });
  if (held.isErr()) {
    return err(held.error);
  }
  const unread = unreadBesideTornTail({ path, unparsed: held.value.unparsed });
  if (unread.isErr()) {
    return err(unread.error);
  }
  if (unread.value.length > 0) {
    return err(HandStepErrors.registerIncomplete({ lineNumbers: skippedLines({ unparsed: unread.value }) }));
  }
  return ok({ rows: held.value.rows, unparsed: unread.value });
}

/**
 * The offered re-cut posting, carrying the instant of a posting of the same id already on disk.
 *
 * A retry after a re-cut was cut short rebuilds the step, and `hand post` stamps a fresh `postedIso` unless
 * `--posted-iso` was passed, so the posting that did land reads as a conflict on its instant alone and the
 * settling the first attempt owed is never written. Only the instant is adopted:
 * every other field must still match, so a genuinely different step under a reused id is still refused.
 *
 * @param rows the register as read under the lock
 * @param step the new posting as offered
 * @returns the posting to compare against what is held
 */
function asRetryOf({ rows, step }: { rows: readonly HandRow[]; step: HandStep }): HandRow {
  const held = rows.find((row) => !isSettledRow(row) && row.step.id === step.id);
  if (held === undefined || isSettledRow(held)) {
    return { kind: "posted", step };
  }
  return { kind: "posted", step: { ...step, postedIso: held.step.postedIso } };
}

/**
 * How a step's posting form reads in a refusal: its row's slug, or `--standalone` when it names none.
 *
 * @param row the row the step names, if any
 * @returns the slug or the flag
 */
function postingFormOf({ row }: { row: string | undefined }): string {
  if (row === undefined) {
    return "--standalone";
  }
  return row;
}

/** What a batch of settlings did. */
export interface HandBatchReceipt {
  /** The ids settled, in the order they were written. Empty when the batch was. */
  readonly ids: readonly string[];
  /** The ids offered that were no longer open under the lock — settled by another writer first — so not written. */
  readonly skipped: readonly string[];
  readonly path: string;
  readonly unparsed: readonly HandStepError[];
  /** Bytes of a torn last line an interrupted write left, dropped before this append; `0` when there was none. */
  readonly droppedTornBytes: number;
}

/**
 * Settle several open steps in one lock-held append — every row read back before a byte is written, so a
 * batch whose rows will not read is written not at all.
 *
 * An id no longer open under the lock is SKIPPED, never a refusal of the rest. A reconcile computes its batch
 * from a read taken before the lock, so a `hand done` landing in between used to fail the whole pass and leave
 * a card whose row had finished on the owner's queue. The step it names is settled either way.
 *
 * What the reconcile writes: the owner's Done presses and the steps whose row finished, together, so a pass that
 * settles five cards takes the lock once and re-reads the register once rather than five times.
 *
 * @param rows the settlings, each already built with `buildSettledRow`
 * @param nowIso the instant the lock is taken at
 * @param home the state home (defaults to the resolved home)
 * @returns the ids written and the ids skipped, or the first failure — and nothing written on a failure
 */
export function appendHandSettlements({
  rows,
  nowIso,
  home = slopweaverHome(),
}: {
  rows: readonly SettledRow[];
  nowIso: string;
  home?: string;
}): Result<HandBatchReceipt, HandStepError> {
  if (rows.length === 0) {
    return ok({ droppedTornBytes: 0, ids: [], path: handRegisterPath({ home }), skipped: [], unparsed: [] });
  }
  return underLock({ home, nowIso, section: (path) => settleBatchUnderLock({ path, rows }) });
}

/**
 * The batch's critical section.
 *
 * @param path the register file
 * @param rows the settlings offered
 * @returns the ids written and skipped, or the first failure
 */
function settleBatchUnderLock({
  path,
  rows: offered,
}: {
  path: string;
  rows: readonly SettledRow[];
}): Result<HandBatchReceipt, HandStepError> {
  const lines = offered.map((row) => ({ id: row.id, line: serialised({ row }) }));
  for (const { line } of lines) {
    const readBack = readBackOf({ line });
    if (readBack.isErr()) {
      return err(readBack.error);
    }
  }
  const held = readHandRows({ missing: "empty", path });
  if (held.isErr()) {
    return err(held.error);
  }
  // Consumed as it is written, so a second settling of one id in the same batch is skipped too.
  const open = new Set(openHandSteps({ rows: held.value.rows }).map((step) => step.id));
  const kept = lines.filter(({ id }) => open.delete(id));
  const ids = kept.map(({ id }) => id);
  const skipped = lines.filter((entry) => !kept.includes(entry)).map(({ id }) => id);
  const text = kept.map(({ line }) => `${line}\n`).join("");
  const receipt = { ids, path, skipped, unparsed: held.value.unparsed };
  if (kept.length === 0) {
    return ok({ ...receipt, droppedTornBytes: 0 });
  }
  return appendText({ path, text }).map((droppedTornBytes) => ({ ...receipt, droppedTornBytes }));
}
