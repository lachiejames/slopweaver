/**
 * `handover wake`'s question pass — run over EVERY due row before the finish pass, outside its cap: a park on the
 * run's OWN pull request that MERGED while the run waits on the owner's open question has its WAKE suspended, never its
 * seat reseated. A reseat there boots a seat that can do nothing until the owner answers, and closes again.
 *
 * MEASURED on a live board: a park on a merged pull request was reseated with its question open, and another read
 * `would-spawn` on its merged pull request. The reconcile settles a merged park with NO question; this is the rest.
 *
 * What it proves before it suspends:
 *
 * - **The run's CURRENT question, never the park's snapshot.** `heldQuestion` is read off the journal now; the park's
 *   own `question` field outlives every answer, so a question answered or withdrawn since keeps the row due.
 * - **That the question is ALL that is left.** The reconcile's own head and branch reads
 *   (`./wakeReconcile.ts`'s `reconcileDueRow`) class the park with the question and its drafts set aside, and only
 *   `landed` — the run's own branch merged, the pull request AND its head both in the repository the run's checkout
 *   names as `origin`, never a bare branch name alone, and every branch the run names that one
 *   head — suspends. A stack parent's merge, or a
 *   same-named branch in another repository or a fork, unblocks the seat's own work, and a head
 *   or branch that does not read proves nothing: each stays due and takes the finish or reseat it always had. A draft
 *   never needs the seat: a held Slack draft is released by the chair's pass once the owner says yes
 *   (`slack draft approve`), and the question's own drafted message waits on the same answer.
 * - **Nothing said to the seat since it parked.** An answer, a withdrawal, a ruling or a queued message after the
 *   park is the owner's word, and only a reseat delivers it — so such a row stays due, checked again on the append's
 *   own read, with any lifting line landing during the head read refused too. The line carries the journal
 *   length the wake judged at, and the projection voids it over any lifting line past that point — before the
 *   suspension as well as after, since the append's read and write are not atomic.
 * - **MERGED only.** A closed pull request can reopen, and a suspended wake is never read again until the owner answers.
 * - **Every row, outside the finish cap, inside one window.** {@link WAKE_QUESTION_DEADLINE_MS} runs from the pass's
 *   first journal read: no journal is read and no batch of {@link QUESTION_READ_CONCURRENCY} head reads starts past
 *   it, and each batch's suspensions are written before the next starts, so the supervisor's wake reading budget
 *   covers the pass and a run cut short keeps what it judged. A row past the window takes the
 *   finish or reseat it always had.
 * - **Revalidated inside the append, and settled only on a write.** The append's own read re-checks the standing
 *   park (its position AND instant) and the open question (its text AND asked instant); a row leaves the due set only
 *   when a suspension of that park stands on the journal — read back when the append's answer was an error, which a
 *   second wake suspending the same park at once also produces. Otherwise it stays due, the failure running toward
 *   a boot, never a silent hold, with one diagnostic line saying why. A reseat or finish re-reads the park first and
 *   stands down on a suspension another wake wrote (`parkMoved`). The append, under the reseat's own per-park claim,
 *   is `./wakeQuestionSuspend.ts`.
 */
import { heldQuestion } from "../../../handover/heldQuestion.js";
import type { OpenQuestion } from "../../../handover/openQuestion.js";
import { ownerWordSincePark } from "../../../handover/parkWakeSuspension.js";
import { readRunJournal } from "../../../handover/runStore.js";
import type { WakeCandidate } from "../../../handover/wakeCandidates.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { DueRow } from "./wakeFinishPass.js";
import { type JudgedLanding, suspendRow } from "./wakeQuestionSuspend.js";
import { reconcileDueRow } from "./wakeReconcile.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** How many question parks' head reads run at once — the judging pass's own politeness. */
export const QUESTION_READ_CONCURRENCY = 6;

/**
 * No journal is read and no batch of head reads STARTS once this long has passed since the pass's first read — the
 * judging pass's own window (`WAKE_JUDGE_DEADLINE_MS`), so the supervisor's wake reading budget covers the pass.
 */
export const WAKE_QUESTION_DEADLINE_MS = 120_000;

/** What the question pass came to: each suspended row's report by board index, and the rows still due. */
export interface QuestionPassResult {
  readonly suspended: ReadonlyMap<number, WakeRowReport>;
  readonly due: readonly DueRow[];
}

/** A due merged park whose run holds an open question, waiting for its head read. */
interface Asked {
  readonly row: DueRow;
  readonly open: OpenQuestion;
  /** How many lines the journal held when the question was read: a lifting line past it refuses the append. */
  readonly judgedLength: number;
  /** The run's own repository, `owner/repo` lowercased: the only one a pull request that suspends may live in. */
  readonly repository: string;
}

/**
 * Suspend the wake of every due merged park on the run's own branch whose run waits only on the owner's open question.
 *
 * @param due every row the judging pass found due, in board order
 * @param dryRun whether to report `would-suspend` and write nothing
 * @param now the run's instant, which each suspension is stamped with
 * @returns the suspended rows by board index, and every other due row, in the order given
 */
export async function questionPass({
  deps,
  dryRun,
  due,
  home,
  now,
}: {
  deps: HandoverWakeDeps;
  dryRun: boolean;
  due: readonly DueRow[];
  home: string;
  now: Date;
}): Promise<QuestionPassResult> {
  const suspended = new Map<number, WakeRowReport>();
  const startedMs = deps.now().getTime();
  const open = (): boolean => deps.now().getTime() - startedMs < WAKE_QUESTION_DEADLINE_MS;
  const merged = due.filter(({ judgement }) => isMerged({ judgement }));
  const batchOf = { deps, dryRun, home, now, suspended };
  // Pipelined: each batch of six settles as soon as it is prepared, so a slow preparation can
  // never spend the whole window and leave every row unjudged tick after tick.
  let pending: Asked[] = [];
  let journalsRead = 0;
  for (; journalsRead < merged.length && open(); journalsRead += 1) {
    pending.push(...askedOf({ deps, home, row: merged[journalsRead]! }));
    if (pending.length === QUESTION_READ_CONCURRENCY) {
      await settleBatch({ ...batchOf, batch: pending });
      pending = [];
    }
  }
  // The last batch was prepared inside the window, so it settles even when the window closed during its reads.
  await settleBatch({ ...batchOf, batch: pending });
  const unjudged = merged.length - journalsRead;
  if (unjudged > 0) {
    deps.writeDiagnostic(
      `handover wake: the ${String(WAKE_QUESTION_DEADLINE_MS / 1000)}s question window closed with ` +
        `${String(unjudged)} merged park(s) unjudged, so each takes its finish or reseat`,
    );
  }
  return { due: due.filter(({ index }) => !suspended.has(index)), suspended };
}

/**
 * One prepared batch: its head and branch reads at once, then each row's finish readiness and suspension at once, all
 * written before the next batch — each row its own journal and its own park claim.
 */
async function settleBatch({
  batch,
  deps,
  dryRun,
  home,
  now,
  suspended,
}: {
  batch: readonly Asked[];
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  now: Date;
  suspended: Map<number, WakeRowReport>;
}): Promise<void> {
  const read = await Promise.all(batch.map((one) => landingOf({ asked: one, deps, home })));
  const reports = await Promise.all(
    batch.map(({ judgedLength, open, row }, at) =>
      suspendRow({ deps, dryRun, home, judged: read[at]!, judgedLength, now, open, row }),
    ),
  );
  batch.forEach(({ row }, at) => {
    const report = reports[at];
    if (report !== undefined) {
      suspended.set(row.index, report);
    }
  });
}

/** Whether the row's judging read found its pull request MERGED — the only park a suspension can follow. */
function isMerged({ judgement }: { judgement: DueRow["judgement"] }): boolean {
  return judgement.observed.kind === "checks" && judgement.observed.prState === "MERGED";
}

/** The row with its open question, when its run holds one and nothing has been said to the seat since; else nothing. */
function askedOf({
  deps,
  home,
  row,
}: {
  deps: Pick<HandoverWakeDeps, "readOrigin" | "writeDiagnostic">;
  home: string;
  row: DueRow;
}): readonly Asked[] {
  const read = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: row.slug });
  if (read.isErr()) {
    deps.writeDiagnostic(`handover wake: ${row.slug}'s journal did not re-read, so its wake is not suspended`);
    return [];
  }
  if (read.value.unreadable.length > 0) {
    deps.writeDiagnostic(
      `handover wake: ${row.slug}'s journal has a line this build cannot read, so its wake is not suspended`,
    );
    return [];
  }
  const { events } = read.value;
  const open = heldQuestion({ events });
  // The owner's word to the seat since it parked is work only a reseat delivers, whatever the question.
  if (open === undefined || ownerWordSincePark({ events, parkIndex: row.candidate.parkIndex }) !== undefined) {
    return [];
  }
  const repository = ownRepositoryOf({ deps, row });
  return repository === undefined ? [] : [{ judgedLength: events.length, open, repository, row }];
}

/**
 * The `owner/repo` of the run's own checkout (its doc's `repo:`), lowercased for GitHub's case-blind names, or
 * `undefined` with a diagnostic when it does not read — then nothing proves a merged pull request is the run's own.
 */
function ownRepositoryOf({
  deps,
  row,
}: {
  deps: Pick<HandoverWakeDeps, "readOrigin" | "writeDiagnostic">;
  row: DueRow;
}): string | undefined {
  const checkout = row.candidate.docRepo;
  if (checkout === undefined) {
    deps.writeDiagnostic(`handover wake: ${row.slug}'s doc names no repo:, so its wake is not suspended`);
    return undefined;
  }
  const origin = deps.readOrigin({ cwd: checkout });
  if (origin.isErr()) {
    deps.writeDiagnostic(
      `handover wake: ${row.slug}'s checkout ${checkout} has no origin read, so its wake is not suspended`,
    );
    return undefined;
  }
  return `${origin.value.owner}/${origin.value.repo}`.toLowerCase();
}

/** What the reconcile's own head and branch reads saw, kept so the question pass can hold them to a stricter bar. */
interface SeenReads {
  headRepository: string | undefined;
  headRefOid: string | undefined;
  headState: string | undefined;
  branchUnread: boolean;
  readonly worktreeBranches: string[];
}

/** The reconcile's head and branch reads, passed through unchanged and recorded in `seen` as they answer. */
function watchedReads({ deps }: { deps: Pick<HandoverWakeDeps, "readBranch" | "readPrHead"> }): {
  reading: Pick<HandoverWakeDeps, "readBranch" | "readPrHead">;
  seen: SeenReads;
} {
  const seen: SeenReads = {
    branchUnread: false,
    headRefOid: undefined,
    headRepository: undefined,
    headState: undefined,
    worktreeBranches: [],
  };
  const reading: Pick<HandoverWakeDeps, "readBranch" | "readPrHead"> = {
    readBranch: (args) => {
      const branch = deps.readBranch(args);
      if (branch.isErr()) {
        seen.branchUnread = true;
      } else if (branch.value !== null) {
        seen.worktreeBranches.push(branch.value);
      }
      return branch;
    },
    readPrHead: async (args) => {
      const head = await deps.readPrHead(args);
      seen.headRepository = head.isOk() ? head.value.headRepository : undefined;
      seen.headRefOid = head.isOk() ? head.value.headRefOid : undefined;
      seen.headState = head.isOk() ? head.value.state : undefined;
      return head;
    },
  };
  return { reading, seen };
}

/**
 * Why the reconcile's own reads prove too little for a suspension, or `undefined`: the judging pass's checks read said
 * MERGED, so the fresh head read must say so too, and a worktree branch read that failed proves nothing
 * even when a stated branch matched the head.
 */
function readDoubt({ seen }: { seen: SeenReads }): string | undefined {
  if (seen.branchUnread) {
    return "its worktree's branch did not read";
  }
  return seen.headState === "MERGED" ? undefined : `its head read ${String(seen.headState)}`;
}

/**
 * The reconcile's class for the park with its question and its drafts set aside, so only what ELSE it left decides:
 * a draft waits on the owner and the chair, never on the seat. A `landed` class suspends only when the run's
 * ownership of that pull request is unambiguous ({@link ownershipDoubt}); otherwise the row stays due, said once.
 */
async function landingOf({
  asked,
  deps,
  home,
}: {
  asked: Asked;
  deps: Pick<HandoverWakeDeps, "readBranch" | "readPrHead" | "writeDiagnostic">;
  home: string;
}): Promise<JudgedLanding> {
  const { repository, row } = asked;
  const { candidate, judgement } = row;
  const { question: _snapshot, drafts: _drafts, ...parked } = candidate.parked;
  const { reading, seen } = watchedReads({ deps });
  const landing = await reconcileDueRow({ candidate: { ...candidate, parked }, deps: reading, home, judgement });
  const { headRefOid } = seen;
  if (landing?.kind !== "landed") {
    return { headRefOid, landing };
  }
  const { observed } = judgement;
  const unread = readDoubt({ seen });
  if (unread !== undefined) {
    deps.writeDiagnostic(`handover wake: ${row.slug}'s wake is not suspended: ${unread}`);
    return { headRefOid, landing: undefined };
  }
  const doubt = ownershipDoubt({
    baseRepository: observed.kind === "checks" ? observed.repo : undefined,
    branches: [...candidate.statedBranches, ...startedBranches({ candidate }), ...seen.worktreeBranches],
    headRefName: landing.headRefName,
    headRepository: seen.headRepository,
    repository,
  });
  if (doubt !== undefined) {
    deps.writeDiagnostic(`handover wake: ${row.slug}'s wake is not suspended: ${doubt}`);
    return { headRefOid, landing: undefined };
  }
  return { headRefOid, landing };
}

/** The current cycle's `started` branch as a list, empty when it recorded none. */
function startedBranches({ candidate }: { candidate: WakeCandidate }): readonly string[] {
  if (candidate.startedBranch === undefined) {
    return [];
  }
  return [candidate.startedBranch];
}

/**
 * Why a merged pull request is not proven to be the one carrying the run's own work, or `undefined` when it is. Two
 * failure modes: a bare branch name matches a same-named branch in another repository or a
 * fork, and the reconcile calls a head "own" when it matches ANY branch the run ever named — so a stack parent the
 * run once started on reads as its own while the work left is on the child. Here every branch the run names (its
 * doc's `branch:`, the branch it recorded, the branch its worktree has out) must be that one head, in the run's
 * own repository; any disagreement keeps the row due, which is the main-branch behaviour.
 *
 * @param baseRepository the `owner/repo` the pull request merged into, as the wake named it
 * @param headRepository the `owner/repo` its head branch lives in, when GitHub named one
 * @param repository the run checkout's own `origin`, lowercased
 * @param branches every branch the run names, the worktree's current one included when it read
 * @returns the doubt, or `undefined` when the pull request is unambiguously the run's own
 */
function ownershipDoubt({
  baseRepository,
  branches,
  headRefName,
  headRepository,
  repository,
}: {
  baseRepository: string | undefined;
  branches: readonly string[];
  headRefName: string;
  headRepository: string | undefined;
  repository: string;
}): string | undefined {
  if (![baseRepository, headRepository].every((name) => name?.toLowerCase() === repository)) {
    return (
      `its merged pull request is not proven to live in its own repository ${repository} ` +
      `(base ${String(baseRepository)}, head ${String(headRepository)})`
    );
  }
  const others = [...new Set(branches)].filter((branch) => branch !== headRefName);
  if (others.length > 0) {
    return `the run also names ${others.join(", ")} beside the merged head ${headRefName}, so its own work may be on another branch`;
  }
  return undefined;
}
