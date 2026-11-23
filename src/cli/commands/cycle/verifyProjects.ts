/**
 * The `--verify` leg for project updates: re-read live, through the door, the projects a bronze-only pass
 * would put on the card as overdue.
 *
 * ## Why a fresh cursor does not make this unnecessary
 *
 * MEASURED on the real home. Another session posted status updates to three of the owner's
 * projects, having refreshed Linear bronze first. A `session-start --verify` run about forty-eight minutes later
 * still put all three on their card as `status update overdue`, and one of them had just received the first
 * update of its life. Compare any project record's own age against the source cursor with:
 *
 * ```
 * slopweaver cycle reconcile --json | jq '[.proposals[] | select(.action == "project-update")] | length'
 * cat "$SLOPWEAVER_HOME/corpus/watermarks/linear.json"
 * ```
 *
 * The newest bronze record for the project in question carried an old `tsIso` and an
 * empty `projectUpdates` connection — five days stale — while the Linear watermark cursor read
 * a time twenty-four minutes BEFORE the posts. Bronze can only know an update a refresh
 * has walked, so a post after the cursor is invisible to a plain pass however recently it ran. (The refresh
 * itself now selects a project whose updates moved, and the pass folds in the standalone update records, so
 * the corpus does catch up on the next refresh — see `projectPageQueryVariables` and `withBronzeUpdates`.)
 *
 * ## What it reads, and what it refuses to conclude
 *
 * The project's `projectUpdates` connection, one full page — NOT the project object. The SDK's
 * `ProjectDocument` selects no updates at all, and reading that document for them answered "never updated"
 * for every project: measured, a verified pass turned a correct "22 days" into "never" on all
 * three of their projects. A connection that is absent or malformed, or a partial page holding no update, is not a
 * history this leg saw, so the project keeps its bronze row and is counted as unread rather than overwritten. A
 * partial page that does hold updates is a floor: it can move the last update forward, never back.
 *
 * ## Bounded exactly like its neighbour
 *
 * It reads only the projects the card would otherwise name — never every project they lead, and never a
 * search — and stops at {@link PROJECT_VERIFY_MAX}. The candidate set is taken from the proposals a pure
 * pass over bronze already made, so the set verified and the set shown cannot drift apart: they are the
 * same function's output, run twice.
 */

import { linearToken } from "../../../config.js";
import { PROJECT_UPDATES_PAGE_SIZE } from "../../../corpus/linear/queries.js";
import { liveProjectUpdates, type ProjectUpdateHistory } from "../../../cycle/projectHistory.js";
import type { Result } from "../../../lib/result.js";
import type { LinearLiveError } from "../../../live/linear/errors.js";
import { type LinearReadRequest, linearReadRequest, readLinearProjectUpdates } from "../../../live/linear/read.js";

/**
 * How many live reads one project-update verify pass may make. A daily card is not a backfill.
 *
 * Lower than the pull-request leg's bound because the population is smaller by construction: these are
 * projects one person LEADS and that are already overdue, which measured three on the real home against
 * twenty-five attached pull requests.
 *
 * @internal — the bound {@link verifyOverdueProjects} applies; no caller outside this module names it.
 */
export const PROJECT_VERIFY_MAX = 20;

/**
 * What one project verify pass read, and what it could not.
 *
 * @internal — the shape {@link verifyOverdueProjects} returns; no caller names it directly.
 */
export interface ProjectVerifyOutcome {
  /** The live update history, keyed by project id. */
  readonly seen: ReadonlyMap<string, ProjectUpdateHistory>;
  /**
   * Every project this pass learned nothing new about, by URL: those attempted whose live read failed or was
   * inconclusive, then those past {@link PROJECT_VERIFY_MAX} that were never attempted — so the card can say so
   * rather than quietly keep bronze.
   */
  readonly stillUnknown: readonly string[];
  readonly attempted: number;
}

/**
 * One project this leg will read: its id, and the URL the live reader addresses it by.
 *
 * @internal — the element type {@link verifyOverdueProjects} takes; callers build the literals inline.
 */
export interface ProjectVerifyTarget {
  readonly id: string;
  readonly url: string;
}

/**
 * Resolves the Linear credential a verify pass reads with — {@link linearToken} in production.
 *
 * @internal — the seam {@link verifyOverdueProjects} reads its token through; named by its test.
 */
export type ProjectTokenReader = (args: { home: string }) => string | undefined;

/**
 * Reads one project's `projectUpdates` connection live — {@link readLinearProjectUpdates} in production.
 *
 * @internal — the seam {@link verifyOverdueProjects} reads each project through; named by its test.
 */
export type ProjectUpdatesReader = (args: {
  address: string;
  limit: number;
  request: LinearReadRequest;
}) => Promise<Result<unknown, LinearLiveError>>;

/**
 * Re-read, live, the update history of every project a bronze-only pass judged overdue.
 *
 * A read that fails, or answers nothing it can conclude from, leaves that project on bronze rather than
 * dropping it — an unreadable project is one
 * this pass knows nothing new about, and silently removing it from the card would be the more expensive
 * error of the two. It is named in {@link ProjectVerifyOutcome.stillUnknown} so the reader learns which.
 *
 * @param targets the projects the card would otherwise name, in the order it would name them
 * @param home the state home whose credential is used
 * @param tokenFor resolves that credential; the configured Linear token unless a test supplies its own
 * @param readUpdates performs each live read; the Linear door unless a test supplies its own
 * @returns the live histories read, plus every project that stayed unknown
 */
export async function verifyOverdueProjects({
  targets,
  home,
  tokenFor = linearToken,
  readUpdates = readLinearProjectUpdates,
}: {
  targets: readonly ProjectVerifyTarget[];
  home: string;
  tokenFor?: ProjectTokenReader;
  readUpdates?: ProjectUpdatesReader;
}): Promise<ProjectVerifyOutcome> {
  const token = tokenFor({ home });
  if (token === undefined) {
    return { attempted: 0, seen: new Map(), stillUnknown: targets.map((target) => target.url) };
  }
  const attempted = targets.slice(0, PROJECT_VERIFY_MAX);
  const request = linearReadRequest({ token });
  const seen = new Map<string, ProjectUpdateHistory>();
  const stillUnknown: string[] = [];
  for (const target of attempted) {
    // The updates connection itself, one full page: the project object's own document never selected it.
    const read = await readUpdates({ address: target.url, limit: PROJECT_UPDATES_PAGE_SIZE, request });
    const history = read.isOk() ? liveProjectUpdates({ connection: read.value }) : undefined;
    if (history === undefined) {
      stillUnknown.push(target.url);
      continue;
    }
    seen.set(target.id, history);
  }
  stillUnknown.push(...targets.slice(PROJECT_VERIFY_MAX).map((target) => target.url));
  return { attempted: attempted.length, seen, stillUnknown };
}
