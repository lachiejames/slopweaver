/**
 * The WRITE half of `handover wake`'s question pass (`./wakeQuestionPass.ts` judges): one judged park's
 * `park-wake-suspended` line, appended under the reseat's own per-park claim, revalidated on the append's own read,
 * and settled only when a suspension of that park stands on the journal.
 *
 * - **Under the reseat's per-park claim**. A reseat holds it from its last park read through
 *   `cmux spawn` (`./wakeReseat.ts`), so a suspension appended outside it could land after that read and the seat boot
 *   anyway. A claim another wake holds keeps the row due: that wake is reseating the park now.
 * - **The worktree holds the merged head's COMMIT and nothing beside it**, read under the claim
 *   right before the append (`./wakeWorktreeCommit.ts`): a branch name outlives the merge, so a commit made on it
 *   afterwards, or work left uncommitted, keeps every name equal. A worktree that is gone or does not read keeps the
 *   row due, as does a head GitHub named no commit for, and so does a `HEAD` that is not the merged branch itself —
 *   a paused rebase reads clean and detached on the right commit.
 * - **The question is ALL that is left**: the real `handover finish --dry-run --beside-question`
 *   passes before any claim is taken, as exactly the finish a landed park with no question gets: probes, pages and
 *   the checks read decide, the lesson question is forced loud as the reconcile forces it.
 * - **Revalidated inside the append**. The transition check refuses another park, another question or
 *   an owner word since the park; {@link judgementStale} adds the park's instant and any lifting line since the
 *   journal length the wake judged at.
 * - **Settled only on a standing suspension**. On an append error the journal is read back, and a
 *   suspension a second wake wrote at the same moment counts; anything else keeps the row due, with one diagnostic.
 */
import type { RunEvent } from "../../../handover/ledger.js";
import type { OpenQuestion } from "../../../handover/openQuestion.js";
import { activeParkedCheckpoint, parkAsItWaits } from "../../../handover/parked.js";
import type { ParkedLanding } from "../../../handover/parkedLanding.js";
import { liftsSuspension } from "../../../handover/parkWakeSuspension.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { claimWakePark } from "../../../handover/wakeJournalStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { finishReadyBesideQuestion } from "./wakeDueFinish.js";
import type { DueRow } from "./wakeFinishPass.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** What the question pass's head read came to for one row: the landing class, and the merged head's commit. */
export interface JudgedLanding {
  /** The reconcile's class with the question and drafts set aside, or `undefined` when ownership was in doubt. */
  readonly landing: ParkedLanding | undefined;
  /** The commit the pull request's head pointed at, frozen at the merge, when GitHub named one. */
  readonly headRefOid: string | undefined;
}

/**
 * One question park's suspension, written under the park's claim.
 *
 * @param judgedLength how many lines the journal held when the question was read; a lifting line past it refuses
 * @param judged the reconcile's class with its question and drafts set aside, and the merged head's commit
 * @param open the run's open question, which the line names
 * @returns the row's report when its wake is (or on a dry run would be) suspended, else `undefined`: still due
 */
export async function suspendRow({
  deps,
  dryRun,
  home,
  judged,
  judgedLength,
  now,
  open,
  row,
}: {
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  judged: JudgedLanding;
  judgedLength: number;
  now: Date;
  open: OpenQuestion;
  row: DueRow;
}): Promise<WakeRowReport | undefined> {
  const { candidate, judgement, slug } = row;
  const { observed } = judgement;
  const { headRefOid, landing } = judged;
  if (landing?.kind !== "landed" || observed.kind !== "checks") {
    return undefined;
  }
  const why =
    `${observed.repo}#${String(observed.number)} (${landing.headRefName}) merged while the run waits on the ` +
    "owner's question, so a reseat could only close again";
  // No `reconciliation` field: that counts what the finish pass's reconcile settled, and this row skipped it.
  const base = { judgement, slug, wake: candidate.parked.wake };
  const merged = { headRefName: landing.headRefName, headRefOid };
  const carried = (): boolean =>
    undoubted({ deps, doubt: commitDoubt({ deps, merged, worktree: candidate.parked.worktree }), slug });
  if (!carried()) {
    return undefined;
  }
  const unready = await finishReadyBesideQuestion({ candidate, deps, home, judgement });
  if (!undoubted({ deps, doubt: unready, slug })) {
    return undefined;
  }
  if (dryRun) {
    // Re-read past the readiness child in the live run's order, the journal LAST.
    const held = carried() && undoubted({ deps, doubt: dryRunStale({ home, judgedLength, row }), slug });
    return held ? { ...base, action: "would-suspend", detail: `would suspend the wake: ${why}` } : undefined;
  }
  const release = takeClaim({ deps, home, row });
  if (release === undefined) {
    return undefined;
  }
  try {
    // Read under the claim, right before the append: a commit made on the branch after the merge,
    // or work left uncommitted, keeps every NAME equal while the worktree holds what the merge never carried.
    return carried() ? appendSuspension({ base, deps, home, judgedLength, now, open, row, why }) : undefined;
  } finally {
    release();
  }
}

/**
 * Take the park's wake claim for the suspension, or say why not: a claim that errs, or one another wake holds while
 * it reseats the park now, keeps the row due.
 */
function takeClaim({
  deps,
  home,
  row,
}: {
  deps: Pick<HandoverWakeDeps, "now" | "writeDiagnostic">;
  home: string;
  row: DueRow;
}): (() => void) | undefined {
  const { candidate, slug } = row;
  const claim = claimWakePark({
    home,
    nowIso: deps.now().toISOString(),
    parkIndex: candidate.parkIndex,
    parkedAtIso: candidate.parked.atIso,
    slug,
  });
  if (claim.isErr()) {
    deps.writeDiagnostic(`handover wake: ${slug}'s wake was not suspended: ${claim.error.message}`);
    return undefined;
  }
  const taken = claim.value;
  if (taken.kind === "in-flight") {
    deps.writeDiagnostic(
      `handover wake: ${slug}'s wake was not suspended: another wake is reseating it now (${taken.reason})`,
    );
    return undefined;
  }
  return taken.release;
}

/** Whether nothing was doubted, writing the one diagnostic that says why the row stays due when something was. */
function undoubted({
  deps,
  doubt,
  slug,
}: {
  deps: Pick<HandoverWakeDeps, "writeDiagnostic">;
  doubt: string | undefined;
  slug: string;
}): boolean {
  if (doubt !== undefined) {
    deps.writeDiagnostic(`handover wake: ${slug}'s wake was not suspended: ${doubt}`);
  }
  return doubt === undefined;
}

/**
 * Why the parked worktree is not proven to hold exactly the merged head and nothing beside it, or `undefined` when it
 * is. A worktree that is gone or does not read proves nothing, so the row stays due — and nor does one whose `HEAD`
 * is not the merged branch itself: a rebase, a bisect or any detached `HEAD` reads clean on the right commit while a
 * Git operation is still the seat's to finish.
 */
function commitDoubt({
  deps,
  merged,
  worktree,
}: {
  deps: Pick<HandoverWakeDeps, "readWorktreeCommit">;
  merged: { headRefName: string; headRefOid: string | undefined };
  worktree: string;
}): string | undefined {
  const { headRefName, headRefOid } = merged;
  if (headRefOid === undefined) {
    return "GitHub named no head commit for its merged pull request";
  }
  const read = deps.readWorktreeCommit({ cwd: worktree });
  if (read.isErr()) {
    return `its worktree ${worktree} did not read: ${read.error.message}`;
  }
  if (read.value.branch !== headRefName) {
    return `its worktree ${worktree} has ${read.value.branch} out, not the merged branch ${headRefName}`;
  }
  if (read.value.oid !== headRefOid) {
    return `its worktree stands on ${read.value.oid}, not the merged head ${headRefOid}`;
  }
  return read.value.dirty ? `its worktree ${worktree} has changes the merged head does not carry` : undefined;
}

/** The suspension's append, run under the park's claim: its report, or `undefined` when no suspension stands. */
function appendSuspension({
  base,
  deps,
  home,
  judgedLength,
  now,
  open,
  row,
  why,
}: {
  base: Pick<WakeRowReport, "judgement" | "slug" | "wake">;
  deps: Pick<HandoverWakeDeps, "writeDiagnostic">;
  home: string;
  judgedLength: number;
  now: Date;
  open: OpenQuestion;
  row: DueRow;
  why: string;
}): WakeRowReport | undefined {
  const { candidate, slug } = row;
  const runsDir = stateHomePaths({ home }).runs;
  const written = applyRowEvent({
    event: {
      atIso: now.toISOString(),
      judgedLength,
      kind: "park-wake-suspended",
      parkIndex: candidate.parkIndex,
      question: open.question,
      questionAskedIso: open.askedIso,
      why,
    },
    precondition: ({ events }) => judgementStale({ events, judgedLength, parkedAtIso: candidate.parked.atIso }),
    runsDir,
    slug,
  });
  if (written.isErr() && !suspensionStands({ parkIndex: candidate.parkIndex, runsDir, slug })) {
    deps.writeDiagnostic(
      `handover wake: ${slug}'s wake was not suspended, so it takes its finish or reseat: ${written.error.message}`,
    );
    return undefined;
  }
  return { ...base, action: "wake-suspended", detail: `wake suspended until the owner's question is answered: ${why}` };
}

/**
 * Why the wake's judgement no longer holds on the append's own read, run as its precondition. The transition check
 * already refuses a suspension naming another park or another question, or one written after the owner's word to
 * the seat (`straySuspendReason`). This adds the park's INSTANT, so the position names the park the wake judged, and
 * refuses any lifting line that landed during the head read.
 *
 * @param judgedLength how many lines the journal held when the wake read the question
 * @param parkedAtIso the instant of the park the wake judged
 * @returns why the append is refused, or `undefined` when the judgement still holds
 */
export function judgementStale({
  events,
  judgedLength,
  parkedAtIso,
}: {
  events: readonly RunEvent[];
  judgedLength: number;
  parkedAtIso: string;
}): string | undefined {
  if (activeParkedCheckpoint({ events })?.atIso !== parkedAtIso) {
    return "the park the wake judged no longer stands";
  }
  const since = events.slice(judgedLength).find((event) => liftsSuspension({ event }));
  return since === undefined ? undefined : `a ${since.kind} line landed while the wake judged the park`;
}

/**
 * The dry run's stand-in for the append precondition: why the journal, read now, no longer carries the judgement,
 * or `undefined` when it does. An owner word journalled while the readiness child ran must stop a dry run's
 * `would-suspend` exactly as the live run's precondition stops its append; a journal that does not read whole
 * proves nothing, so it doubts too. It is the LAST read, after the worktree's, as the precondition is on a live run:
 * a dry run writes nothing, so a worktree that moves after its read is the snapshot's residue, not a missed suspension.
 */
function dryRunStale({
  home,
  judgedLength,
  row,
}: {
  home: string;
  judgedLength: number;
  row: DueRow;
}): string | undefined {
  const read = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: row.slug });
  if (read.isErr() || read.value.unreadable.length > 0) {
    return "its journal did not read whole after the readiness check";
  }
  return judgementStale({ events: read.value.events, judgedLength, parkedAtIso: row.candidate.parked.atIso });
}

/**
 * Whether the journal, read back, holds a STANDING suspension of the park at `parkIndex` — this run's line, or one a
 * second wake wrote at the same moment, which is why this run's own append answered with an error.
 */
function suspensionStands({ parkIndex, runsDir, slug }: { parkIndex: number; runsDir: string; slug: string }): boolean {
  const read = readRunJournal({ runsDir, slug });
  if (read.isErr() || read.value.unreadable.length > 0) {
    return false;
  }
  const waiting = parkAsItWaits({ events: read.value.events });
  return waiting?.parkIndex === parkIndex && waiting.suspension !== undefined;
}
