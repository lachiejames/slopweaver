/** The effectful shell for `slopweaver github search`. */

import { githubToken, parseRepositorySlug, type Repository, resolveRepository } from "../../../config.js";
import { githubScopeId, makeGithubClient } from "../../../corpus/github/githubClient.js";
import { logger } from "../../../lib/logger.js";
import { safeProviderCall } from "../../../lib/providerCall.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../live/github/errors.js";
import {
  type GithubSearchDocument,
  renderGithubSearchJson,
  renderGithubSearchText,
  searchGithubObjects,
} from "../../../live/github/search.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { githubVerbErrorLines } from "./errors.js";
import { githubSearchUsage } from "./reportUsage.js";
import { parseGithubSearchArgs } from "./searchCore.js";

const VERB_ARG_OFFSET = 4;

/** Injectable command edges. A plain fake exercises the shell without Octokit or credentials. */
export interface GithubSearchDeps {
  readonly resolveRepo: (args: { explicit: string | undefined; home: string | undefined }) => Result<Repository>;
  readonly search: (args: {
    term: string;
    repo: Repository;
    limit: number;
    home: string | undefined;
  }) => Promise<Result<GithubSearchDocument, GithubLiveError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The refusal line `--complete` prints when the page is a sample rather than the set.
 *
 * @param document the bounded search document
 * @returns one diagnostic naming what was held, what GitHub counted, and that the set is unknown
 */
export function completeRefusalLine({ document }: { document: GithubSearchDocument }): string {
  return (
    `github search --complete refused for "${document.term}" in ${document.repo}: ${document.coverage.detail}. ` +
    "The set is UNKNOWN, not a list; nothing was written to stdout."
  );
}

/**
 * Run one `github search` invocation against injected edges.
 *
 * A search that finds nothing is a normal, expected outcome, not a fault: it still exits `EXIT_OK`'s sibling
 * `EXIT_EXPECTED_EMPTY`, so a caller scripting "does this exist" can branch on the exit code without parsing
 * output, while a genuine parse, repo-resolution or provider failure keeps its own distinct exit code. The
 * exit code is decided once, from the document, before either renderer runs: `--json` changes the FORMAT of
 * what is printed and nothing else, so a watcher branching on the code reads the same answer either way.
 *
 * The repository is resolved from `--repo`, else from the cwd's `origin` — and a cwd nobody chose (the state
 * home, a checkout that is not declared) is REFUSED rather than searched, because a plausible zero from the
 * wrong repository is the one answer a watcher cannot tell from a real one (`config.ts`'s
 * `cwdRepositoryRefusal`). Whichever way it resolved, the first line of the output names it.
 *
 * Under `--complete`, a bounded page is refused with `EXIT_ERROR` and NOTHING on stdout — never `EXIT_EXPECTED_EMPTY`,
 * which a caller reads as "the set is empty", the exact false-drain a truncated enumeration produces. A caller
 * that branches "0 or 3 is a set, anything else is UNKNOWN" is therefore correct without parsing the document.
 *
 * @param rest argv after `github search`
 * @param deps the repo-resolution, search and output seams
 * @returns the process exit code
 */
export async function runGithubSearch({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubSearchDeps;
}): Promise<number> {
  const parsed = parseGithubSearchArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of githubVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(githubSearchUsage());
    return EXIT_USAGE;
  }
  const repo = deps.resolveRepo({ explicit: parsed.value.repo, home: parsed.value.home });
  if (repo.isErr()) {
    for (const problem of repo.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const result = await deps.search({
    home: parsed.value.home,
    limit: parsed.value.limit,
    repo: repo.value,
    term: parsed.value.term,
  });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  if (parsed.value.complete && result.value.coverage.kind === "bounded") {
    deps.writeDiagnostic(completeRefusalLine({ document: result.value }));
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json
      ? renderGithubSearchJson({ document: result.value })
      : renderGithubSearchText({ document: result.value }),
  );
  return result.value.matches.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Production search edge: a resilient Octokit client, governed by the same `safeProviderCall` pacing and
 * retry policy as every other GitHub operation.
 *
 * @returns credential-aware, safe search + repo resolution, and output sinks
 */
export function productionGithubSearchDeps(): GithubSearchDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    resolveRepo: ({ explicit, home }) => {
      if (explicit !== undefined) {
        return parseRepositorySlug({ slug: explicit });
      }
      return resolveRepository(home === undefined ? {} : { home });
    },
    search: async ({ term, repo, limit, home }) => {
      const token = githubToken(home === undefined ? {} : { home });
      const client = makeGithubClient({ token });
      const scopeId = githubScopeId({ token });
      return searchGithubObjects({
        limit,
        nowIso,
        repo,
        search: async ({ q, per_page }) => {
          const called = await safeProviderCall({
            execute: () => client.rest.search.issuesAndPullRequests({ per_page, q }),
            operation: "github.search.issuesAndPullRequests",
            provider: "github",
            retryMode: "never",
            scopeId,
          });
          return called.isErr()
            ? err(GithubLiveErrors.searchFailed({ cause: called.error, message: called.error.message }))
            : ok({
                incomplete_results: called.value.data.incomplete_results,
                items: called.value.data.items,
                total_count: called.value.data.total_count,
              });
        },
        term,
      });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver github search`. */
export const githubSearchCommand = defineCommand({
  run: (argv) => runGithubSearch({ deps: productionGithubSearchDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
