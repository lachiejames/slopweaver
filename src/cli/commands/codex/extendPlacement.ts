/**
 * Where `codex extend` places a run: the branch its journal recorded at its latest `handover start`, and the
 * checkout of that branch whose repository the row is scoped by.
 *
 * The branch comes ONLY from the journal, never a flag, so a row names the branch the run actually works on. The
 * checkout is the run's latest launched worktree, or `--repo`, and it must have that branch out. A journal never
 * started, or one holding lines this build cannot decode that are not merely a newer build's kinds, is refused
 * rather than guessed at.
 */
import { currentBranch, resolveGitCommonDir, resolveRepoRoot } from "../../../codex/gitDiff.js";
import { currentCycle, type RunEvent, runStateOf } from "../../../handover/ledger.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

/** Every way a run cannot be placed on a branch and a checkout. */
type RunPlacementCode =
  | "JOURNAL_UNREADABLE"
  | "JOURNAL_UNDECODABLE"
  | "NEVER_STARTED"
  | "NO_WORKTREE"
  | "NOT_A_CHECKOUT"
  | "BRANCH_NOT_OUT"
  | "REPOSITORY_UNREADABLE";

/** Why a run could not be placed, so nothing is recorded against a branch or repository guessed at. */
interface RunPlacementError {
  readonly code: RunPlacementCode;
  readonly message: string;
}

/** Factories for {@link RunPlacementError}, so every sentence is worded in one place. */
const RunPlacementErrors = {
  branchNotOut: ({ branch, repoRoot, run }: { branch: string; repoRoot: string; run: string }): RunPlacementError => ({
    code: "BRANCH_NOT_OUT",
    message: `${repoRoot} does not have run ${run}'s branch ${branch} out — pass --repo <its checkout>`,
  }),
  journalUndecodable: ({ run }: { run: string }): RunPlacementError => ({
    code: "JOURNAL_UNDECODABLE",
    message: `the journal of run ${run} holds lines this build cannot decode, so which branch it is on cannot be told`,
  }),
  journalUnreadable: ({ cause, run }: { cause: string; run: string }): RunPlacementError => ({
    code: "JOURNAL_UNREADABLE",
    message: `the journal of run ${run} would not read: ${cause}`,
  }),
  neverStarted: ({ run }: { run: string }): RunPlacementError => ({
    code: "NEVER_STARTED",
    message: `run ${run} has never been started, so it names no branch to extend`,
  }),
  noWorktree: ({ run }: { run: string }): RunPlacementError => ({
    code: "NO_WORKTREE",
    message: `run ${run}'s journal names no launched worktree — pass --repo <its checkout>`,
  }),
  notACheckout: ({ cause, worktree }: { cause: string; worktree: string }): RunPlacementError => ({
    code: "NOT_A_CHECKOUT",
    message: `${worktree} is not a readable checkout: ${cause}`,
  }),
  repositoryUnreadable: ({ cause, repoRoot }: { cause: string; repoRoot: string }): RunPlacementError => ({
    code: "REPOSITORY_UNREADABLE",
    message: `which repository ${repoRoot} is could not be read: ${cause}`,
  }),
} as const;

/** Where the run's branch and checkout were read from. */
export interface PlacedRun {
  readonly branch: string;
  readonly repoRoot: string;
  readonly gitCommonDir: string;
}

/** The worktree the current cycle's latest `launched` event names, if any. */
function launchedWorktree({ events }: { events: readonly RunEvent[] }): string | undefined {
  let worktree: string | undefined;
  for (const event of currentCycle({ events })) {
    if (event.kind === "launched" && event.worktree !== undefined) {
      worktree = event.worktree;
    }
  }
  return worktree;
}

/** The checkout the supervisor named with `--repo`, else the one the journal last launched, else none. */
function checkoutNamed({
  events,
  repo,
}: {
  events: readonly RunEvent[];
  repo: string | undefined;
}): string | undefined {
  if (repo !== undefined) {
    return repo;
  }
  return launchedWorktree({ events });
}

/**
 * The checkout at `worktree`, checked to have `branch` out, and the repository it belongs to.
 *
 * @param worktree the directory the journal or `--repo` named
 * @returns the placed run, or which check failed
 */
function placeCheckout({
  branch,
  run,
  worktree,
}: {
  branch: string;
  run: string;
  worktree: string;
}): Result<PlacedRun, RunPlacementError> {
  const repoRoot = resolveRepoRoot({ cwd: worktree });
  if (repoRoot.isErr()) {
    return err(RunPlacementErrors.notACheckout({ cause: repoRoot.error.message, worktree }));
  }
  const out = currentBranch({ cwd: repoRoot.value });
  if (out.isErr() || out.value !== branch) {
    return err(RunPlacementErrors.branchNotOut({ branch, repoRoot: repoRoot.value, run }));
  }
  const gitCommonDir = resolveGitCommonDir({ cwd: repoRoot.value });
  if (gitCommonDir.isErr()) {
    return err(
      RunPlacementErrors.repositoryUnreadable({ cause: gitCommonDir.error.message, repoRoot: repoRoot.value }),
    );
  }
  return ok({ branch, gitCommonDir: gitCommonDir.value, repoRoot: repoRoot.value });
}

/**
 * Place a run: the branch its journal recorded, and the checkout of that branch the row is scoped by.
 *
 * @param home the state home holding the run's journal
 * @param repo the `--repo` the supervisor passed, when the journal names no launched worktree
 * @returns the branch, the checkout and its repository, or which placement failed
 */
export function placeRun({
  home,
  run,
  repo,
}: {
  home: string;
  run: string;
  repo: string | undefined;
}): Result<PlacedRun, RunPlacementError> {
  const journal = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: run });
  if (journal.isErr()) {
    return err(RunPlacementErrors.journalUnreadable({ cause: journal.error.message, run }));
  }
  const { events, unknownKind, unreadable } = journal.value;
  if (unreadable.length > unknownKind.length) {
    return err(RunPlacementErrors.journalUndecodable({ run }));
  }
  const branch = runStateOf({ events }).branch;
  if (branch === undefined) {
    return err(RunPlacementErrors.neverStarted({ run }));
  }
  const worktree = checkoutNamed({ events, repo });
  if (worktree === undefined) {
    return err(RunPlacementErrors.noWorktree({ run }));
  }
  return placeCheckout({ branch, run, worktree });
}
