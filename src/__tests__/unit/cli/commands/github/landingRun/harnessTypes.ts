/**
 * The shapes the `runGithubLanding` harness returns: the record of what one run asked its seams for, and the clock
 * its reads and waits share.
 */
import type { PressLedgerRow } from "../../../../../../cli/commands/github/landingPressRow.js";
import type { GithubLandingDeps } from "../../../../../../cli/commands/github/landingRun.js";
import type { ReadRecord } from "../../../../../../review/readJournal.js";
import type { ReviewerAskedRow } from "../../../../../../review/reviewerRegister.js";

/** What one run produced, and what it asked its seams for. */
export interface Harness {
  readonly deps: GithubLandingDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  /** Every enqueue argv this run handed the press seam, joined by a space. */
  readonly pressed: string[];
  /** Every press this run recorded, as `owner/name#number@head`. */
  readonly recorded: string[];
  /** Every base branch the queue read was asked about, as `owner/name#branch`. */
  readonly queueAsked: string[];
  /** Every board row this run wrote, as the argv `handover register` was handed. */
  readonly registered: string[][];
  /** Every completed fleet read this run recorded. */
  readonly readsRecorded: ReadRecord[];
  /** Every readings-ledger append this run asked for, as `by` and the document bytes. */
  readonly readingsRecorded: { readonly by: string; readonly document: string; readonly observedAtIso: string }[];
  /** Every AUTONOMY-ledger row this run asked the ledger to write, refused ones included. */
  readonly autonomyRows: PressLedgerRow[];
  /** Every reviewer-register append this run asked for. */
  readonly askAppends: { readonly nowIso: string; readonly rows: readonly ReviewerAskedRow[] }[];
  /** Every repository this run asked GitHub's open census for, in order. */
  readonly censusAsked: string[];
  /** Every `github comment create` argv this run handed the re-request seam, joined by a space. */
  readonly commented: string[];
  /** Every head this run reserved in the CodeRabbit nudge register, as `owner/name#number@head`. */
  readonly reserved: string[];
  /** Every wait this run asked for, in milliseconds. */
  readonly slept: number[];
  /** How many press-time conversation re-reads this run made. */
  readonly judged: { count: number };
  /** Every job-log read `--pr` asked for, as `owner/name run <id> jobs <ids>`. */
  readonly logsAsked: string[];
  /** Every changed-file read `--pr` asked for, as `owner/name#number`. */
  readonly filesAsked: string[];
  /** Every pull request whose closure this run read, as `owner/name#number`. */
  readonly closuresAsked: string[];
  /** Every board row this run settled, as the argv `handover settle` was handed. */
  readonly settled: string[][];
}

/** The record half of a {@link Harness}: every ledger the seams write into, without the seams themselves. */
export type HarnessRecord = Omit<Harness, "deps">;

/**
 * One monotonic clock for the whole run: the fleet read's observation, the queue reads after it and every wait all
 * read and move this, so "twenty seconds after the read" is arithmetic a case can assert.
 */
export interface HarnessClock {
  ms: number;
}
