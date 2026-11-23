/**
 * The settled-chase hold at recording, under either identity (`./draftRecordHolds.ts`, `./draftRecordBotRun.ts`): read
 * the live state of every pull request a `bump` or `review-ask` links, and refuse the row when one is closed, merged,
 * missing or unread, or when a pull-request link names no number it can read. The rule is `../../../outbound/slack/settledChase.ts`; this is the one effectful step it needs.
 *
 * Run once the rendered message exists, which resolving its mentions may already have read Slack for, and before
 * the `auth.test`, the thread read and any stored media, so a moot chase writes nothing. A row of any other act, or
 * one linking no pull request, reads nothing here at all.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { PullRequestLiveState } from "../../../live/github/pullRequestState.js";
import {
  chasedPullRequests,
  settledChaseRefusals,
  unnamedPullRequestLinks,
} from "../../../outbound/slack/settledChase.js";
import { ChaseSubjectErrors } from "../../../outbound/slack/settledChaseErrors.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { NOTHING_PARKED } from "./draftMedia.js";

/** The one edge the hold adds to `SlackDraftDeps` (`./draftRun.ts`), which extends this. */
export interface ChaseHoldDeps {
  /**
   * The live state of one pull request a `bump` or `review-ask` links. `notChecked` is the read not happening, which
   * parks nothing: a chase whose pull request may be closed is the row this hold stops.
   */
  readonly pullRequestState: (args: { home: string; repo: string; number: number }) => Promise<PullRequestLiveState>;
}

/**
 * Whether the row may park, given the live state of each pull request it chases.
 *
 * @param deps the injected world, for the live pull-request read
 * @param options the parsed record, whose `--act` decides whether anything is read
 * @param payload the rendered message, which the links are read off
 * @returns nothing on a pass, or the refusal lines closing on the nothing-parked line
 */
export async function settledChaseHold({
  deps,
  options,
  payload,
}: {
  deps: ChaseHoldDeps;
  options: Pick<DraftRecordOptions, "act" | "home">;
  payload: unknown;
}): Promise<Result<true>> {
  const { act, home } = options;
  if (act === undefined) {
    return ok(true);
  }
  const refs = chasedPullRequests({ act, payload });
  const unnamed = unnamedPullRequestLinks({ act, payload }).map(
    (url) => ChaseSubjectErrors.unnamed({ act, url }).message,
  );
  if (refs.length === 0 && unnamed.length === 0) {
    return ok(true);
  }
  // One read per distinct pull request; `Promise.all` keeps the results, and so the refusals, in link order.
  const reads = await Promise.all(
    refs.map(async (ref) => ({
      ref,
      state: await deps.pullRequestState({ home, number: ref.number, repo: `${ref.owner}/${ref.repo}` }),
    })),
  );
  const refusals = [...unnamed, ...settledChaseRefusals({ act, reads })];
  return refusals.length === 0 ? ok(true) : err([...refusals, NOTHING_PARKED]);
}
