/**
 * The injected edges and the resolved target every `slopweaver github checks` shell shares.
 *
 * Types only, so the status loop (`./checksRun.ts`), the event loop (`./checksEventWatch.ts`), the `--log` read
 * (`./checksLogRun.ts`) and the production edge (`./checksDeps.ts`) all import them from one leaf rather than
 * from the run file that imports each of them.
 */

import type { Repository } from "../../../config.js";
import type { Result } from "../../../lib/result.js";
import type { RequiredCheckContexts } from "../../../live/github/branchProtection.js";
import type { GithubChecksSnapshot } from "../../../live/github/checks.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import type { GithubJobLogError } from "../../../live/github/jobLogErrors.js";
import type { JobLogDocument } from "../../../live/github/jobLogRead.js";
import type { GithubPrActivity } from "../../../live/github/prEvents.js";
import type { RegisterRecorders } from "./checksRegister.js";

/** Injectable command edges. A plain fake exercises the shell without Octokit, a clock or a real sleep. */
export interface GithubChecksDeps extends RegisterRecorders {
  readonly resolveRepo: (args: { explicit: string | undefined }) => Result<Repository>;
  readonly fetchChecks: (args: {
    owner: string;
    repo: string;
    number: number;
    limit: number;
    home: string | undefined;
  }) => Promise<Result<GithubChecksSnapshot, GithubLiveError>>;
  readonly fetchActivity: (args: {
    owner: string;
    repo: string;
    number: number;
    home: string | undefined;
  }) => Promise<Result<GithubPrActivity, GithubLiveError>>;
  /**
   * The status-check contexts the pull request's BASE branch requires — classic branch protection and
   * rulesets unioned, the same read `github enqueue` gates its queue verdict on.
   */
  readonly fetchRequiredContexts: (args: {
    owner: string;
    repo: string;
    branch: string;
    home: string | undefined;
  }) => Promise<Result<RequiredCheckContexts, GithubLiveError>>;
  /**
   * `--log`'s read: one Actions run's selected job logs, bounded. Injected as its own seam rather than
   * built here so a fake drives the whole `--log` path without a network or a credential.
   */
  readonly readJobLogs: (args: {
    owner: string;
    repo: string;
    runId: number;
    jobIds: readonly number[];
    lines: number;
    home: string | undefined;
  }) => Promise<Result<JobLogDocument, GithubJobLogError>>;
  readonly now: () => Date;
  readonly sleep: (args: { ms: number }) => Promise<void>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The resolved identity one run polls, threaded through every path. */
export interface PollTarget {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly limit: number;
  readonly home: string | undefined;
  readonly deadlineMs: number;
  readonly timeoutSeconds: number;
}
