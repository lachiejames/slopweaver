/**
 * Effectful shell for `slopweaver github pr standing`: one by-number GraphQL read of a pull request, two REST
 * reads of its base branch's review rules and one of the branch itself for its `protected` flag, projected by
 * `./prStandingCore.ts`. Read-only — it writes no ledger,
 * no description and no local record, and fetches nothing into a checkout, which is why the console voice may
 * run it (`../../../talk/modelReads.ts`).
 *
 * Dispatched by `./run.ts` before `parseGithubPrArgs`, exactly where `summary` is.
 */
import { githubToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { GithubReadGraphql, GithubReadRest } from "../../../live/github/read.js";
import { githubReadGraphql, githubReadRest, parseGithubReadAddress } from "../../../live/github/read.js";
import { makeReviewGateRead } from "../../../live/github/reviewRules.js";
import { CHECK_PAGE, makeGithubReviewStateApi } from "../../../live/github/reviewState.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  branchProtectedOf,
  githubPrStandingOf,
  parseGithubPrStandingArgs,
  renderGithubPrStandingText,
} from "./prStandingCore.js";
import { GITHUB_PR_STANDING_USAGE } from "./prUsage.js";

/** Injectable edges, so a unit test drives this with plain functions and no network. */
export interface GithubPrStandingDeps {
  readonly graphql: (args: { home: string | undefined }) => GithubReadGraphql;
  readonly rest: (args: { home: string | undefined }) => GithubReadRest;
  readonly nowIso: () => string;
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
}

/**
 * Read one pull request and its base branch, and print its standing.
 *
 * A base branch whose rules could not be read is NOT a failure: the standing says so in its own words, because
 * every other answer about the pull request still holds. Every non-zero exit is a failure of fact — a bad
 * address, or a pull-request read that did not answer.
 *
 * @param deps the read seams, clock and output
 * @param rest argv after `github pr standing`
 * @returns the process exit code
 */
export async function runGithubPrStanding({
  deps,
  rest,
}: {
  deps: GithubPrStandingDeps;
  rest: readonly string[];
}): Promise<number> {
  const parsed = parseGithubPrStandingArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic({ line: problem });
    }
    deps.writeDiagnostic({ line: GITHUB_PR_STANDING_USAGE });
    return EXIT_USAGE;
  }
  const { home, json, url } = parsed.value;
  const address = parseGithubReadAddress({ address: url });
  if (address.isErr()) {
    deps.writeDiagnostic({ line: address.error.message });
    return EXIT_USAGE;
  }
  if (address.value.kind !== "pull-request") {
    deps.writeDiagnostic({ line: `${url} is not a pull-request address` });
    return EXIT_USAGE;
  }
  const { number, owner, repo } = address.value;
  const read = await makeGithubReviewStateApi({ graphql: deps.graphql({ home }) }).pr({
    checkLimit: CHECK_PAGE,
    fileLimit: 1,
    number,
    owner,
    repo,
    withBodies: false,
  });
  if (read.isErr()) {
    deps.writeDiagnostic({ line: read.error.message });
    return EXIT_ERROR;
  }
  const restRead = deps.rest({ home });
  const branch = read.value.baseRefName;
  const baseGate = await makeReviewGateRead({ rest: restRead })({ branch, owner, repo });
  const branchRead = await restRead({
    params: { branch, owner, repo },
    route: "GET /repos/{owner}/{repo}/branches/{branch}",
  });
  const baseProtected = branchProtectedOf({ response: branchRead.isOk() ? branchRead.value : undefined });
  const standing = githubPrStandingOf({ baseGate, baseProtected, pr: read.value, readAtIso: deps.nowIso() });
  if (json) {
    deps.out({ line: JSON.stringify(standing) });
    return EXIT_OK;
  }
  for (const line of renderGithubPrStandingText({ standing })) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/**
 * Production edges: the credential resolves from the named home, both reads go through the provider door.
 *
 * @returns the deps
 */
export function productionGithubPrStandingDeps(): GithubPrStandingDeps {
  const token = ({ home }: { home: string | undefined }): string | undefined =>
    githubToken(home === undefined ? {} : { home });
  return {
    graphql: ({ home }) => githubReadGraphql({ token: token({ home }) }),
    nowIso: () => new Date().toISOString(),
    out: logger.out,
    rest: ({ home }) => githubReadRest({ token: token({ home }) }),
    writeDiagnostic: ({ line }) => {
      logger.warn({ msg: line });
    },
  };
}
