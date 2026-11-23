/**
 * A plain fake of `github exposure`'s read seam: each call answered by a handler the test supplies, an empty
 * listing (in its wrapper when the call has one) for every other list, and a 404 for every other document. Not a
 * mock: it records what it was asked and returns what it was told to.
 */

import { err, ok, type Result } from "../lib/result.js";
import type { GithubExposureSeam } from "../live/github/exposureListing.js";
import {
  GITHUB_EXPOSURE_CALLS,
  type GithubExposureCallId,
  type GithubExposureReadFailure,
} from "../live/github/exposureModel.js";

/** The route parameters a call was made with. */
export type GithubExposureFakeParams = Readonly<Record<string, string | number>>;

/** One call's answer, from its parameters. */
export type GithubExposureFakeHandler = (args: {
  params: GithubExposureFakeParams;
}) => Result<unknown, GithubExposureReadFailure>;

/** GitHub's answer to a document that is not there, or not visible. */
export const GITHUB_EXPOSURE_NOT_FOUND: GithubExposureReadFailure = { message: "Not Found", status: 404 };

/**
 * An empty answer for a call: an empty list, in its wrapper when it has one, or a 404 for a document.
 *
 * @param call the call answered
 * @returns the answer
 */
function emptyGithubExposureAnswer({
  call,
}: {
  call: GithubExposureCallId;
}): Result<unknown, GithubExposureReadFailure> {
  const { itemsKey } = GITHUB_EXPOSURE_CALLS[call];
  if (["repository", "pages", "git-tree", "git-ref", "git-blob"].includes(call)) {
    return err(GITHUB_EXPOSURE_NOT_FOUND);
  }
  return ok(itemsKey === undefined ? [] : { [itemsKey]: [], total_count: 0 });
}

/**
 * A seam answering from per-call handlers, recording every call it was asked for.
 *
 * @param handlers the answers by call; a call with none gets {@link emptyGithubExposureAnswer}
 * @param graphql the one GraphQL answer; by default a failure, since few fixtures turn discussions on
 * @returns the seam and the record of what it was asked
 */
export function fakeGithubExposureSeam({
  handlers,
  graphql = () => err({ message: "no graphql in this fixture", status: undefined }),
}: {
  handlers: Partial<Record<GithubExposureCallId, GithubExposureFakeHandler>>;
  graphql?: () => Result<unknown, GithubExposureReadFailure>;
}): {
  seam: GithubExposureSeam;
  asked: { call: GithubExposureCallId; params: GithubExposureFakeParams }[];
} {
  const asked: { call: GithubExposureCallId; params: GithubExposureFakeParams }[] = [];
  return {
    asked,
    seam: {
      get: ({ call, params }) => {
        asked.push({ call, params });
        const handler = handlers[call];
        return Promise.resolve(handler === undefined ? emptyGithubExposureAnswer({ call }) : handler({ params }));
      },
      graphql: () => Promise.resolve(graphql()),
    },
  };
}
