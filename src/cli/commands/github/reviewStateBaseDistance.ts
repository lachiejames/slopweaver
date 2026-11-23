/**
 * Pairing each pull request in a `github review-state` read with the base distance the comparison answered for
 * it — the one step where the answer list and the pull-request list must correspond one to one, so it sits
 * beside `./reviewStateRun.ts` rather than inside it, behind the one comparison seam that run injects.
 */
import { err, ok } from "#lib/result.js";
import type { BaseDistance, BaseDistanceRead } from "../../../live/github/baseDistance.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/**
 * Attach each answer to the pull request at the same position.
 *
 * A read that answered fewer pull requests than it was asked about is broken correspondence, never a pull
 * request nobody asked about: no row may claim "not requested" for a distance that was requested, so the whole
 * read fails and names both counts.
 */
function withBaseDistances({
  prs,
  answers,
}: {
  prs: readonly PrLiveState[];
  answers: readonly BaseDistance[];
}): GithubVerbResult<readonly PrLiveState[]> {
  if (answers.length < prs.length) {
    return err(GithubVerbErrors.baseDistancesShort({ expected: prs.length, received: answers.length }));
  }
  return ok(prs.map((pr, index) => ({ ...pr, baseDistance: answers[index]! })));
}

/**
 * Attach how far each head is from its base, when the invocation asked for it.
 *
 * @param prs every pull request the fleet read returned
 * @param args the parsed invocation's state home and whether it asked for the comparison at all
 * @param baseDistances the comparison seam, built only when the comparison is actually made
 * @returns the same pull requests, each carrying its distance when one was asked for, or a short read's failure
 */
export async function addBaseDistance({
  prs,
  args,
  baseDistances,
}: {
  prs: readonly PrLiveState[];
  args: { readonly home: string | undefined; readonly readBaseDistance: boolean };
  baseDistances: (args: { home: string | undefined }) => BaseDistanceRead;
}): Promise<GithubVerbResult<readonly PrLiveState[]>> {
  if (!args.readBaseDistance || prs.length === 0) {
    return ok(prs);
  }
  const answers = await baseDistances({ home: args.home })({ subjects: prs });
  return withBaseDistances({ answers, prs });
}
