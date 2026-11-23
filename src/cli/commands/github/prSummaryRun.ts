/**
 * Effectful shell for `slopweaver github pr summary`: one GraphQL read of a pull request, projected by
 * `./prSummaryCore.ts`. Read-only — it never writes a description, a ledger or a local record.
 *
 * Dispatched by `./run.ts` before `parseGithubPrArgs`, exactly where `request-review` and `retarget` are.
 */
import { githubToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { GithubReadGraphql } from "../../../live/github/read.js";
import { githubReadGraphql, parseGithubReadAddress, readGithubObject } from "../../../live/github/read.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { githubPrSummaryOf, parseGithubPrSummaryArgs, renderGithubPrSummaryText } from "./prSummaryCore.js";
import { GITHUB_PR_SUMMARY_USAGE } from "./prUsage.js";

/** Injectable edges, so a unit test drives this with plain functions and no network. */
export interface GithubPrSummaryDeps {
  readonly graphql: (args: { home: string | undefined }) => GithubReadGraphql;
  readonly nowIso: () => string;
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
}

/**
 * Read one pull request and print its summary.
 *
 * A description the card cannot read is NOT a failure here: it is a `declined` form in the output and exit 0,
 * because the read succeeded and the decline is its answer. Every non-zero exit is a failure of fact — a bad
 * address, a read that did not answer, or an object that is not a pull request.
 *
 * @param deps the read seam, clock and output
 * @param rest argv after `github pr summary`
 * @returns the process exit code
 */
export async function runGithubPrSummary({
  deps,
  rest,
}: {
  deps: GithubPrSummaryDeps;
  rest: readonly string[];
}): Promise<number> {
  const parsed = parseGithubPrSummaryArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic({ line: problem });
    }
    deps.writeDiagnostic({ line: GITHUB_PR_SUMMARY_USAGE });
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
  const read = await readGithubObject({ address: url, graphql: deps.graphql({ home }), limit: 1, nowIso: deps.nowIso });
  if (read.isErr()) {
    deps.writeDiagnostic({ line: read.error.message });
    return EXIT_ERROR;
  }
  const summary = githubPrSummaryOf({ data: read.value.data, readAtIso: read.value.readAtIso });
  if (summary.isErr()) {
    for (const problem of summary.error) {
      deps.writeDiagnostic({ line: `${url}: ${problem}` });
    }
    return EXIT_ERROR;
  }
  if (json) {
    deps.out({ line: JSON.stringify(summary.value) });
    return EXIT_OK;
  }
  for (const line of renderGithubPrSummaryText({ summary: summary.value })) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/**
 * Production edges: the credential resolves from the named home, the read goes through the provider door.
 *
 * @returns the deps
 */
export function productionGithubPrSummaryDeps(): GithubPrSummaryDeps {
  return {
    graphql: ({ home }) => githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }),
    nowIso: () => new Date().toISOString(),
    out: logger.out,
    writeDiagnostic: ({ line }) => {
      logger.warn({ msg: line });
    },
  };
}
