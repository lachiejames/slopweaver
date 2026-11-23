/**
 * The `runGithubLanding` harness: every seam of the landing verb faked, and a record of what one run asked each
 * of them for.
 */
import type { AutonomyActionRow } from "../../../../../../autonomy/types.js";
import type { GithubLandingDeps } from "../../../../../../cli/commands/github/landingRun.js";
import type { RunDisposition } from "../../../../../../handover/boardTypes.js";
import type { Result } from "../../../../../../lib/result.js";
import type { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import type { GithubJobLogError } from "../../../../../../live/github/jobLogErrors.js";
import type { JobLogDocument } from "../../../../../../live/github/jobLogRead.js";
import type { PrClosure } from "../../../../../../live/github/prClosure.js";
import type { PullRequestFileStatuses } from "../../../../../../live/github/pullRequestFilesRead.js";
import type { PrLivePage, PrLiveState } from "../../../../../../live/github/reviewState.js";
import type { Organisation } from "../../../../../../organisation/core.js";
import type { OrganisationError } from "../../../../../../organisation/errors.js";
import type { QueueAvailability } from "../../../../../../review/landing.js";
import type { LandingBoardRow } from "../../../../../../review/landingBoard.js";
import type { ReadRecord } from "../../../../../../review/readJournal.js";
import { fakeReviewState } from "./fakeReviewState.js";
import { childSeams, ledgerSeams, nudgeSeams } from "./harnessActs.js";
import { boardSeams, githubReadSeams, pressTimeSeams } from "./harnessReads.js";
import type { Harness, HarnessClock, HarnessRecord } from "./harnessTypes.js";

/** What a case sets on the harness; every field but `pages` has a default that means "nothing unusual happened". */
export interface HarnessOptions {
  /** What the organisation read answers; the acme organisation unless the case says otherwise. */
  organisation?: Result<Organisation, OrganisationError>;
  /** What GitHub says about each pull request's ending, by number; a number absent here fails its read. */
  closures?: ReadonlyMap<number, PrClosure>;
  /** A row as re-read AFTER GitHub answered, by slug, when it changed since the board snapshot. */
  rowsNow?: ReadonlyMap<string, { status: string; run: RunDisposition["kind"] }>;
  /** What `handover settle` exits with. */
  settleExit?: number;
  /** What every job-log read answers. */
  jobLogs?: Result<JobLogDocument, GithubJobLogError>;
  /** What the changed-file read answers. */
  prFiles?: Result<PullRequestFileStatuses, ReturnType<typeof GithubLiveErrors.readFailed>>;
  pages: readonly PrLivePage[];
  /** The heads the CodeRabbit nudge register already holds. */
  nudgedHeads?: ReadonlySet<string>;
  /** Whether the nudge register cannot be read at all. */
  nudgedHeadsUnreadable?: boolean;
  /** What reserving a head answers — `already-recorded` is another pass having taken it during the wait. */
  reserveAnswer?: "reserved" | "already-recorded";
  /** What `github comment create` exits with. */
  commentExit?: number;
  /** How far the monotonic clock moves during each base-branch queue read — time spent AFTER the fleet read. */
  queueReadMs?: number;
  /** The head GitHub reports at PRESS time, when it differs from the head the read judged. */
  headsNow?: string;
  /** The conversation GitHub reports at PRESS time, when it differs from the one the read judged. */
  judgmentNow?: PrLiveState;
  queue?: QueueAvailability;
  board?: ReadonlyMap<string, readonly LandingBoardRow[]>;
  presses?: ReadonlyMap<string, { atIso: string; headOid: string }>;
  /** What the cadence register already holds, keyed as `readJournal.ts` keys a selection. */
  reads?: ReadonlyMap<string, ReadRecord>;
  pressExit?: number;
  registerExit?: number;
  /**
   * What the autonomy ledger answers EVERY write with, when it refuses: an `ACTION_ID_CONFLICT` a racing session's
   * act caused, or a store outage. The store is compare-and-set, so the verb writes once and reports this.
   */
  autonomyRefusal?: string;
  /** What each read of the autonomy ledger answers, in order, the last answer repeating. */
  ledger?: readonly Result<readonly AutonomyActionRow[], string>[];
  /** Whether the store refuses the cadence write. */
  recordReadFails?: boolean;
  /** Whether the store refuses the press row after a press. */
  recordPressFails?: boolean;
  /** Whether the press register cannot be read. */
  pressesUnreadable?: boolean;
  /** Whether the cadence register cannot be read. */
  readsUnreadable?: boolean;
  /** The readings ledger's refusal, when it refuses the append. */
  readingRefusal?: string;
  /** The declared checkout for the row's repository; `null` stands for none declared. */
  checkout?: string | null;
}

/** An empty record for one run: every ledger the seams write into, nothing in any of them yet. */
function freshRecord(): HarnessRecord {
  return {
    askAppends: [],
    autonomyRows: [],
    censusAsked: [],
    closuresAsked: [],
    commented: [],
    diagnostics: [],
    filesAsked: [],
    judged: { count: 0 },
    logsAsked: [],
    out: [],
    pressed: [],
    queueAsked: [],
    readingsRecorded: [],
    readsRecorded: [],
    recorded: [],
    registered: [],
    reserved: [],
    settled: [],
    slept: [],
  };
}

/**
 * Builds a landing run's dependencies, every seam faked, together with the record of what the run asked for.
 *
 * @param given what the case seeds; every field but `pages` defaults to "nothing unusual happened"
 * @returns the dependencies and the ledgers a case asserts on
 */
export function harness(given: HarnessOptions): Harness {
  // Read every option exactly once, as the single destructure this harness replaced did, so the seam builders
  // below all see one snapshot rather than each re-reading the caller's object.
  const options: HarnessOptions = { ...given };
  const record = freshRecord();
  const clock: HarnessClock = { ms: 0 };
  const deps: GithubLandingDeps = {
    ...boardSeams({ options, record }),
    ...pressTimeSeams({ options, record }),
    ...githubReadSeams({ clock, options, record }),
    ...nudgeSeams({ options, record }),
    ...childSeams({ options, record }),
    ...ledgerSeams({ options, record }),
    now: () => new Date("2026-09-09T12:30:00.000Z"),
    reviewState: fakeReviewState({
      monotonicMs: () => clock.ms,
      pages: options.pages,
      writeDiagnostic: (line) => {
        record.diagnostics.push(line);
      },
      writeOut: (line) => {
        record.out.push(line);
      },
    }),
    sessionRef: () => "workspace:137",
    sleep: ({ milliseconds }) => {
      record.slept.push(milliseconds);
      clock.ms += milliseconds;
      return Promise.resolve();
    },
    writeDiagnostic: (line) => {
      record.diagnostics.push(line);
    },
    writeOut: (line) => {
      record.out.push(line);
    },
  };
  return { ...record, deps };
}
