/**
 * The edges every whole-repository stack verb injects.
 *
 * `stack restack` and `stack submit` need exactly the same four: real Git, a GitHub write client, a clock
 * and an output sink, plus the token resolver that builds the client. Two identical copies is what the
 * `duplicate-windows` gate saw the moment the second verb was written, and two copies is also how they would
 * drift into two ideas of which token a repository is reached with.
 */

import { githubToken } from "../../../config.js";
import { type GithubWriteApi, makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { type GithubPushDeps, productionGithubPushDeps } from "./pushPrimitives.js";

/** Git, the write API, the clock, the output sink and the token resolver. */
export interface StackVerbDeps {
  readonly git: GithubPushDeps;
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly now: () => Date;
  readonly out: (input: { readonly line: string }) => void;
  readonly token: (input: { readonly home: string }) => string | undefined;
}

/**
 * The production edges.
 *
 * @returns the real Git primitives, API factory, clock, output sink and token resolver
 */
export function productionStackVerbDeps(): StackVerbDeps {
  return {
    git: productionGithubPushDeps(),
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    now: () => new Date(),
    out: logger.out,
    token: ({ home }) => githubToken({ home }),
  };
}
