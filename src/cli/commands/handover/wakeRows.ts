/**
 * `handover wake`'s row loop — what each waking park comes to on one run, kept apart from the verb's parsing
 * and printing in `./wakeRun.ts`.
 *
 * Four passes, in this order, and the order is the design:
 *
 * 1. **Judge** every candidate (`./wakeJudge.ts`): clear what `cmux spawn` would refuse forever, skip a paused
 *    row, and read each clock or bounded checks read, the longest since its last read (or its park) first.
 * 1b. **Question** (`./wakeQuestionPass.ts`), every due row, uncapped: a park whose own branch merged while the run
 *    waits on the owner's CURRENT open question, and nothing else, has its wake suspended — one head read per such
 *    park, none for any other — so no seat boots only to close again; an answer or ruling makes the wake live again.
 * 2. **Finish** — offer each due MERGED park to the real `handover finish` (`./wakeFinish.ts`), at most
 *    `WAKE_FINISH_ASKS` of them, the longest since its last ask (or since due) first, so parks whose finish keeps
 *    refusing take turns rather than every ask on every tick. Each is RECONCILED first (`./wakeReconcile.ts`,
 *    `../../../handover/parkedLanding.ts`): a park on the run's own branch that merged, with no question and no
 *    drafts, is finished past the lesson question and then closed, so its row derives `done`. `--settle-only` lifts
 *    the cap, reconciles the closed parks too, and stops here — no reseat at all. The reads and asks are then written down
 *    (`./wakeTurns.ts`), pruned to every waking park the scan could judge — never by a `--retry`, whose board
 *    predates its wait.
 * 3. **Reseat** the rest in wake order (`../../../handover/wakeOrder.ts`'s `inWakeOrder`): work still to land
 *    before a park whose pull request ended, a doc naming no `repo:` last, each group the longest since its last
 *    attempt (or since due) first — so a park whose spawn keeps failing goes behind every park that waited longer
 *    — against a budget the boots already in flight shrink. The boots are read only HERE,
 *    after the finishes, which can take a minute each: read before them, a boot that landed meanwhile would not
 *    shrink the budget. A checks park whose pull request had not merged is read once more at
 *    its turn (`./wakeDueRow.ts`), since an earlier reseat this run may have moved it — or a closed one been
 *    reopened.
 *
 * **Latency, stated**: a run can spend the judging window, six finish asks and three re-read reseats in
 * series, which `../../../supervisor/scratch/tickCapture.ts` budgets as the wake reading's limit. That is the price
 * of judging every row before waking any; the fill behind it is what the boot share keeps room for, not its clock.
 * A park judged NOT due in the judging pass is not read again this run, so one an earlier reseat made due waits a
 * tick. The order is fixed from the judging pass too: a pull request that closes or merges before its turn stays
 * due and is reseated where it was ranked, ahead of older ended parks, rather than re-ranked behind them
 * — re-ranking would cost that park a tick, and the parks it passed are all still served this run or next.
 *
 * The finish pass is `./wakeFinishPass.ts`. What one due row comes to — a finish is `./wakeDueFinish.ts`; a deferral,
 * a guard hold or a reseat is `./wakeDueRow.ts`.
 */

import type { IngestError } from "#lib/ingestError.js";
import type { Result } from "#lib/result.js";

import type { Repository } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { ParkedLanding } from "../../../handover/parkedLanding.js";
import type { ParkWake, ParkWakeJudgement, ReadChecksWake } from "../../../handover/parkWake.js";
import type { ProbeCheckout } from "../../../handover/probeCheckout.js";
import { type ParkStanding, parkStanding, type WakeCandidate } from "../../../handover/wakeCandidates.js";
import { dueSinceIso, inWakeOrder } from "../../../handover/wakeOrder.js";
import { wakeParkKey } from "../../../handover/wakeTurnStore.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import type { PrHead } from "../../../live/github/prHead.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { ChildOutcome } from "../../../supervisor/scratch/childOutcome.js";
import type { BoundedChildWithStderr } from "../supervisor/scratchChild.js";
import { wakeBootBudget } from "./wakeBootBudget.js";
import { reseatDueRow, type WakeBudget } from "./wakeDueRow.js";
import { type DueRow, type FinishPassResult, finishPass, unsettledRow } from "./wakeFinishPass.js";
import { type DueJudgement, judgeCandidates } from "./wakeJudge.js";
import type { ReadMergeProof, ReadProbeTree } from "./wakeMergeProof.js";
import { questionPass } from "./wakeQuestionPass.js";
import { lastAttempts, priorTurns, recordTurns } from "./wakeTurns.js";
import type { WorktreeCommit, WorktreeCommitError } from "./wakeWorktreeCommit.js";

/** The effects `handover wake` takes, injectable so a test drives it with a fake clock, provider and spawn. */
export interface HandoverWakeDeps {
  readonly now: () => Date;
  /** Waits out a `--retry`'s backoff window; never called on a dry run. */
  readonly sleep: (args: { ms: number }) => Promise<void>;
  /** A fresh id for one reseat attempt — what its settlement and a `--retry` name. */
  readonly nonce: () => string;
  /**
   * When the fleet spawn backoff opens again, read after a spawn it deferred — now, when its window already reads
   * open (a deferral on lock contention alone) — or why the backoff state did not read.
   */
  readonly retryAfter: (args: { home: string; nowIso: string }) => Result<string>;
  /** Whether the environment opened the finished-run break-glass, which the `cmux spawn` child inherits. */
  readonly rerunAllowed: boolean;
  readonly readChecks: (args: { home: string }) => ReadChecksWake;
  /** Runs `cmux spawn <slug>` — the visible reseat — as a bounded child of the installed launcher. */
  readonly reseat: (args: { home: string; slug: string; timeoutMs: number }) => Promise<ChildOutcome>;
  /**
   * Runs `handover finish <slug> --park-index <parkIndex> --parked-at <parkedAtIso> --probed-repo <probedRepo>
   * --probed-tree <probedTree>`, `--dry-run` when asked, as a bounded child no override variable reaches, standing in
   * `cwd` — the parked seat's own worktree, which its probes resolve against, or the state home once that worktree is
   * gone. `probedRepo` and `probedTree` are the `repo:` and tree the wake classified and proved; finish refuses to
   * probe past either if its own read differs. What it printed on stderr comes back with how it ended, so a finish
   * that did not close the run can say which gate refused it.
   */
  readonly finish: (args: {
    /** Whether the child carries the lessons break-glass — a park the reconcile classed `landed` only. */
    allowNoLessons: boolean;
    /** Whether a dry run sets the open question aside — the question pass's readiness ask only. */
    besideQuestion: boolean;
    cwd: string;
    dryRun: boolean;
    home: string;
    parkIndex: number;
    parkedAtIso: string;
    probedRepo: string;
    probedTree: ProbeCheckout["kind"];
    slug: string;
    timeoutMs: number;
  }) => Promise<BoundedChildWithStderr>;
  /** What the checkout at `dir` proves about the merge `oid` — read before a finish stands in the state home. */
  readonly mergeProof: ReadMergeProof;
  /** Which tree a finish standing in `cwd` would probe — the seat's own worktree, or the doc's `repo:`. */
  readonly probeTreeOf: ReadProbeTree;
  /** The head branch of a pull request a park waited on, read once that pull request has ended. */
  readonly readPrHead: (args: {
    home: string;
    repo: string;
    number: number;
  }) => Promise<Result<PrHead, GithubLiveError>>;
  /**
   * The `origin` repository of the run's own checkout (its doc's `repo:`), read by the question pass so a merged pull
   * request is the run's OWN only when its head lives in that repository, never on a bare branch name alone.
   */
  readonly readOrigin: (args: { cwd: string }) => Result<Repository>;
  /**
   * The commit a parked seat's worktree stands on and whether anything sits beside it uncommitted, read by the
   * question pass under the park's claim right before a suspension (`./wakeWorktreeCommit.ts`).
   */
  readonly readWorktreeCommit: (args: { cwd: string }) => Result<WorktreeCommit, WorktreeCommitError>;
  /** `git branch --show-current` in a parked seat's worktree: `null` when detached. */
  readonly readBranch: (args: { cwd: string }) => Result<string | null, IngestError>;
  /**
   * Records `handover close <slug> --summary <summary>` on a landed row whose finish closed its run, so the row
   * derives `done`: the journal path written, or `undefined` when the close refused, its reason already on stderr.
   */
  readonly close: (args: { doc: HandoverDoc; home: string; summary: string }) => string | undefined;
  /** How many Claude sessions started inside the 180-second boot window, read once the finishes are done. */
  readonly bootsInFlight: (args: { home: string }) => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** What one parked row came to on this run. */
export interface WakeRowReport {
  readonly slug: string;
  readonly wake: ParkWake;
  /** A wake judgement, or why none was made: a park cleared or skipped before any clock or check was read. */
  readonly judgement: ParkWakeJudgement | { readonly kind: "not-judged"; readonly reason: string };
  readonly action:
    | "none"
    | "would-spawn"
    | "spawned"
    | "would-finish"
    | "finished"
    | "spawn-failed"
    | "spawn-deferred"
    | "due-deferred"
    | "reseat-in-flight"
    | "paused-skipped"
    | "would-clear"
    | "park-cleared"
    | "park-clear-failed"
    | "would-suspend"
    | "wake-suspended"
    | "wake-journal-failed";
  readonly detail: string;
  /** The reseat attempt's id in the wake journal, once one was appended. */
  readonly attemptNonce?: string;
  /** When the spawn backoff opens again, on a `spawn-deferred` row whose backoff state read. */
  readonly retryAfterIso?: string;
  /** What the reconcile classed a park on an ended pull request as (`../../../handover/parkedLanding.ts`). */
  readonly reconciliation?: ParkedLanding;
  /** Whether a landed row's `handover close` was recorded, would be on a dry run, or did not write. */
  readonly closeOutcome?: "closed" | "would-close" | "close-failed";
  /**
   * The journal position of the park this row judged — with {@link parkedAtIso}, the park's identity. Stamped once
   * every pass is done (`reportedRows`), so it is present on every row the run reports.
   */
  readonly parkIndex?: number;
  /** When the park this row judged was journalled: the Fleet page matches a reading to a board row's park by it. */
  readonly parkedAtIso?: string;
  /**
   * Whether the park this row judged still stands once every pass is done, read off its journal then: the Fleet page
   * drops a park from an older board read by THIS, never by the action — a `spawn-failed` row may have cleared its
   * park or left it.
   */
  readonly parkStanding?: ParkStanding;
}

/** The actions that spend one of a run's attempts — one boot each. */
const ATTEMPT_ACTIONS: ReadonlySet<WakeRowReport["action"]> = new Set([
  "would-spawn",
  "spawned",
  "spawn-failed",
  "spawn-deferred",
]);

/** The actions that retire a park, or would on a real run. */
const CLEAR_ACTIONS: ReadonlySet<WakeRowReport["action"]> = new Set(["would-clear", "park-cleared"]);

/**
 * Split the judged candidates into the rows already reported and the due rows still to finish or reseat.
 *
 * @param judged each candidate's report or due judgement, in candidate order
 * @returns the reports in board order — a hole where a due row's goes — and the due rows
 */
function splitJudged({
  candidates,
  judged,
}: {
  candidates: readonly WakeCandidate[];
  judged: readonly (WakeRowReport | DueJudgement)[];
}): { readonly due: readonly DueRow[]; readonly rows: (WakeRowReport | undefined)[] } {
  const rows: (WakeRowReport | undefined)[] = [];
  const due: DueRow[] = [];
  for (const [index, row] of judged.entries()) {
    if ("action" in row) {
      rows.push(row);
      continue;
    }
    rows.push(undefined);
    const candidate = candidates[index]!;
    const { parkIndex, parked, slug } = candidate;
    const since = dueSinceIso({ parkedAtIso: parked.atIso, wake: parked.wake });
    const key = wakeParkKey({ parkIndex, parkedAtIso: parked.atIso, slug });
    due.push({ candidate, dueSinceIso: since, index, judgement: row, key, slug });
  }
  return { due, rows };
}

/**
 * Judge every candidate, offer the due merged parks to `handover finish`, then reseat the due rows left in wake order
 * until the run's boot budget is spent. Rows are reported in board order whatever order woke them.
 *
 * @param candidates the parks this run serves — the whole board, or a `--retry`'s one
 * @param waking every waking park the scan could judge, which the turn snapshot is pruned to; `undefined` on a retry,
 *   which prunes nothing
 * @param settleOnly whether this run only reconciles and finishes: no ask cap, and no reseat at all
 * @returns every row's report, how many reseats were attempted, how many parks were cleared, and the run's budget
 */
export async function wakeRows({
  candidates,
  deps,
  dryRun,
  home,
  now,
  settleOnly,
  waking,
}: {
  candidates: readonly WakeCandidate[];
  waking: readonly WakeCandidate[] | undefined;
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  now: Date;
  settleOnly: boolean;
}): Promise<{
  readonly attempted: number;
  readonly cleared: number;
  readonly rows: readonly WakeRowReport[];
  readonly budget: WakeBudget;
}> {
  const prior = priorTurns({ deps, home });
  const { judged, read } = await judgeCandidates({ candidates, deps, dryRun, home, lastRead: prior.lastRead, now });
  const split = splitJudged({ candidates, judged });
  const { rows } = split;
  // Before any finish or reseat, uncapped: an ended park waiting on the owner's open question is suspended, never booted.
  const questions = await questionPass({ deps, dryRun, due: split.due, home, now });
  for (const [index, row] of questions.suspended) {
    rows[index] = row;
  }
  const { due } = questions;
  const finished = await finishPass({ deps, dryRun, due, home, lastAsked: prior.lastAsked, settleOnly });
  recordTurns({ asked: finished.asked, deps, dryRun, home, now, prior, read, waking });
  for (const [index, row] of finished.settled) {
    rows[index] = row;
  }
  const reseating = due.filter(({ index }) => !finished.settled.has(index));
  if (settleOnly) {
    for (const { candidate, index, judgement } of reseating) {
      const finishWhy = finished.why.get(index);
      const landing = finished.reconciled.get(index);
      rows[index] = unsettledRow({ finishWhy, judgement, landing, slug: candidate.slug, wake: candidate.parked.wake });
    }
    return { attempted: 0, budget: { bootsInFlight: 0, budget: 0 }, ...reportedRows({ candidates, home, rows }) };
  }
  const { attempted, budget } = await reseatPass({ deps, dryRun, finished, home, now, reseating, rows });
  return { attempted, budget, ...reportedRows({ candidates, home, rows }) };
}

/**
 * Reseat the due rows the finish pass left, in wake order, until the run's boot budget is spent, writing each row's
 * report into `rows` at its board index.
 *
 * @param finished the finish pass, whose sentence and class each reseated row carries
 * @param reseating the due rows no finish settled
 * @param rows the run's reports in board order, filled in place
 * @returns how many reseats were attempted, and the run's budget
 */
async function reseatPass({
  deps,
  dryRun,
  finished,
  home,
  now,
  reseating,
  rows,
}: {
  deps: HandoverWakeDeps;
  dryRun: boolean;
  finished: FinishPassResult;
  home: string;
  now: Date;
  reseating: readonly DueRow[];
  rows: (WakeRowReport | undefined)[];
}): Promise<{ readonly attempted: number; readonly budget: WakeBudget }> {
  const bootsInFlight = reseating.length === 0 ? 0 : deps.bootsInFlight({ home });
  const budget = { bootsInFlight, budget: wakeBootBudget({ bootsInFlight }) };
  const lastTried = reseating.length === 0 ? new Map<string, string>() : lastAttempts({ deps, home });
  const readChecks = deps.readChecks({ home });
  let attempted = 0;
  let backoffHeld = false;
  for (const { candidate, index, judgement } of inWakeOrder({ due: reseating, lastTried })) {
    const finishWhy = finished.why.get(index);
    const row = await reseatDueRow({
      attempted,
      backoffHeld,
      budget,
      candidate,
      deps,
      dryRun,
      finishWhy,
      home,
      judgement,
      now,
      readChecks,
    });
    const landing = finished.reconciled.get(index);
    rows[index] = landing === undefined ? row : { ...row, reconciliation: landing };
    attempted += ATTEMPT_ACTIONS.has(row.action) ? 1 : 0;
    if (row.action === "spawn-deferred") {
      backoffHeld = true;
    }
  }
  return { attempted, budget };
}

/**
 * The rows in board order, the holes filled, each stamped with its park's identity, and how many parks they cleared.
 *
 * @param rows the reports in candidate order, a hole where none was written
 * @returns the reported rows and how many parks they cleared
 */
function reportedRows({
  candidates,
  home,
  rows,
}: {
  candidates: readonly WakeCandidate[];
  home: string;
  rows: readonly (WakeRowReport | undefined)[];
}): {
  readonly cleared: number;
  readonly rows: readonly WakeRowReport[];
} {
  // The slug alone names a row, not a park: a row re-parked on the same pull request is a new park, and a reader
  // matching a reading to a board row needs the instant to tell them apart.
  const runsDir = stateHomePaths({ home }).runs;
  const reported = rows.flatMap((row, index): WakeRowReport[] => {
    if (row === undefined) {
      return [];
    }
    const { parkIndex, parked, slug } = candidates[index]!;
    return [{ ...row, parkIndex, parkStanding: parkStanding({ parkIndex, runsDir, slug }), parkedAtIso: parked.atIso }];
  });
  return { cleared: reported.filter((row) => CLEAR_ACTIONS.has(row.action)).length, rows: reported };
}
