/**
 * What `github landing` touches outside itself, as one contract — its own module so the run file holds the
 * run and nothing else. `landingRun.ts` re-exports it, so every importer keeps the name it always had; the
 * production wiring is `./landingDeps.ts`.
 */
import type { Result } from "../../../lib/result.js";
import type { RepoCensus } from "../../../live/github/openCensus.js";
import type { Organisation } from "../../../organisation/core.js";
import type { OrganisationError } from "../../../organisation/errors.js";
import type { RecordedPress } from "../../../review/landing.js";
import type { LandingBoardRow } from "../../../review/landingBoard.js";
import type { PressJournalError } from "../../../review/pressJournalErrors.js";
import type { ReadRecord } from "../../../review/readJournal.js";
import type { ReadJournalError } from "../../../review/readJournalErrors.js";
import type { ReviewerAskedRow } from "../../../review/reviewerRegister.js";

import type { LandingClosureDeps } from "./landingClosureRun.js";
import type { LandingCodeRabbitNudgeDeps } from "./landingCodeRabbitNudge.js";
import type { LandingDetailDeps } from "./landingDetail.js";
import type { LandingPressDeps } from "./landingPress.js";
import type { QueueFor } from "./landingQueues.js";
import type { GithubReviewStateDeps } from "./reviewStateRun.js";

/**
 * Injectable command edges, so the shell is exercised by plain fakes with no Octokit and no state home.
 *
 * The press edges are inherited from {@link LandingPressDeps} rather than restated, so the write path's own
 * module states exactly what it needs and this one cannot drift from it — and the CodeRabbit re-request's
 * from {@link LandingCodeRabbitNudgeDeps}, less its monotonic clock, which is the review-state read's own
 * (`reviewState.monotonicMs`) so the wait and the observation it is measured from share one clock. The two
 * reads only `--pr` makes come from {@link LandingDetailDeps}, and no other mode calls either. The ended-pull-request
 * read and the settle write `--register` makes come from {@link LandingClosureDeps}.
 */
export interface GithubLandingDeps
  extends
    LandingPressDeps,
    Omit<LandingCodeRabbitNudgeDeps, "monotonicMs">,
    Pick<LandingDetailDeps, "readJobLogs" | "pullRequestFiles">,
    Pick<LandingClosureDeps, "prClosure" | "rowNow" | "settleRow"> {
  /** The review-state seams, reused whole: one fleet read, one required-context read per base branch. */
  readonly reviewState: GithubReviewStateDeps;
  /** Whether one base branch has a merge queue at all. */
  readonly queueFor: QueueFor;
  /** Every handover row that DECLARES a given head branch, keyed by branch name, each with its derived status. */
  readonly boardBranches: (args: { home: string | undefined }) => ReadonlyMap<string, readonly LandingBoardRow[]>;
  /**
   * The presses this machine has already recorded, keyed `owner/name#number` — or the store's refusal, which
   * the read refuses on before any GitHub request.
   */
  readonly presses: (args: {
    home: string | undefined;
  }) => Promise<Result<ReadonlyMap<string, RecordedPress>, PressJournalError>>;
  /** When each selection was last read, keyed as `../../../review/readJournal.ts` keys one, or the refusal. */
  readonly reads: (args: {
    home: string | undefined;
  }) => Promise<Result<ReadonlyMap<string, ReadRecord>, ReadJournalError>>;
  /** Record one COMPLETED fleet read, which is what starts the next cadence window. One attempt, never retried. */
  readonly recordRead: (args: {
    home: string | undefined;
    record: ReadRecord;
  }) => Promise<Result<ReadRecord, ReadJournalError>>;
  /**
   * Append the document this run produced to the readings ledger, as `by`: the row's id, or the ledger's
   * own refusal message. An empty `by` is the ledger's refusal, not the parser's.
   */
  readonly recordReading: (args: {
    home: string | undefined;
    by: string;
    document: string;
    observedAtIso: string;
  }) => Result<string, string>;
  /**
   * Append the asks one recorded read saw to the reviewer register: how many were new, or its refusal. Asked
   * only when `--record-reading` is — one row per ask, however many readings see it.
   */
  readonly appendReviewerAsks: (args: {
    home: string | undefined;
    rows: readonly ReviewerAskedRow[];
    nowIso: string;
  }) => Result<number, string>;
  /**
   * Write one board row, through the verb that owns the board. Returns its exit code. `quiet` sends its receipt
   * to stderr, because a `--json` caller owns stdout.
   */
  readonly registerRow: (args: { argv: readonly string[]; quiet: boolean }) => Promise<number>;
  /**
   * The local checkout a repository is DECLARED at, so a row a session picks up has a tree to cut from.
   *
   * Undefined rather than a failure when none is declared: a board row a chair can read still beats silence,
   * and the outcome line names the missing checkout.
   */
  readonly checkoutFor: (args: { home: string | undefined; repoSlug: string }) => string | undefined;
  /**
   * The organisation the store holds: its repositories are what a bare read covers, beside this build's own, and
   * they say whose work a registered row's pull request is.
   */
  readonly readOrganisation: (args: { home: string | undefined }) => Promise<Result<Organisation, OrganisationError>>;
  /**
   * GitHub's own open list for every selected repository — every author, drafts in — one census each, in the
   * selection's order, read on a read that happens and never on a skipped tick. Never fails: a repository whose
   * census could not be read is an `unread` entry naming why, never a missing one, so a consumer says it cannot
   * count that repository rather than counting it as empty.
   */
  readonly openCensus: (args: { home: string | undefined; repos: readonly string[] }) => Promise<readonly RepoCensus[]>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}
