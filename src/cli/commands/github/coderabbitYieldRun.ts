/**
 * The effectful shell for `slopweaver github coderabbit-yield`: resolve the credential and the author, read,
 * classify, print. It writes nothing anywhere — no thread is resolved, no comment posted.
 *
 * A read that failed part-way prints NOTHING that could pass for a result and exits 1: a short dataset
 * aggregated as though it were whole is exactly the wrong number this verb exists to replace. A read that
 * finished with a coverage gap prints its document, gaps listed, and still exits 1, so a caller that only
 * checks the exit code never mistakes it for complete.
 */

import { githubToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { readCoderabbitYield, viewerLogin } from "../../../live/github/coderabbitYield.js";
import { type GithubReadGraphql, githubReadGraphql } from "../../../live/github/read.js";
import { coderabbitYieldReport, type YieldReport } from "../../../review/coderabbitYield.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseGithubCoderabbitYieldArgs, yieldWindow } from "./coderabbitYieldCore.js";
import { coderabbitYieldDocument, coderabbitYieldLines, type YieldReadFacts } from "./coderabbitYieldReport.js";
import { githubCoderabbitYieldUsage } from "./coderabbitYieldUsage.js";

const VERB_ARG_OFFSET = 4;

/** The edges one invocation touches. */
export interface GithubCoderabbitYieldDeps {
  readonly now: () => Date;
  /** Built only after the arguments parse, so a usage error reads no credential. */
  readonly graphql: (args: { home: string | undefined }) => GithubReadGraphql;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The author to measure: the one named, else whoever the token belongs to; undefined once the failure is said. */
async function resolveAuthor({
  named,
  graphql,
  deps,
}: {
  named: string | undefined;
  graphql: GithubReadGraphql;
  deps: GithubCoderabbitYieldDeps;
}): Promise<string | undefined> {
  if (named !== undefined) {
    return named;
  }
  const viewer = await viewerLogin({ graphql });
  if (viewer.isErr()) {
    deps.writeDiagnostic(`github coderabbit-yield: could not tell whose token this is — ${viewer.error.message}`);
    return undefined;
  }
  return viewer.value;
}

/** Print the report — one JSON document, or the human lines. */
function emit({
  deps,
  facts,
  report,
  json,
}: {
  deps: GithubCoderabbitYieldDeps;
  facts: YieldReadFacts;
  report: YieldReport;
  json: boolean;
}): void {
  if (json) {
    deps.writeOut(
      safeJsonStringify({
        label: "github coderabbit-yield document",
        value: coderabbitYieldDocument({ facts, report }),
      }),
    );
    return;
  }
  for (const line of coderabbitYieldLines({ facts, report })) {
    deps.writeOut(line);
  }
}

/**
 * Run one invocation against injected edges.
 *
 * @param rest argv after `github coderabbit-yield`
 * @param deps the clock, the GraphQL seam and the two output streams
 * @returns the process exit code
 */
export async function runGithubCoderabbitYield({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubCoderabbitYieldDeps;
}): Promise<number> {
  const parsed = parseGithubCoderabbitYieldArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(githubCoderabbitYieldUsage());
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const graphql = deps.graphql({ home: args.home });
  const author = await resolveAuthor({ deps, graphql, named: args.author });
  if (author === undefined) {
    return EXIT_ERROR;
  }
  const started = deps.now();
  const window = yieldWindow({ days: args.days, now: started });
  const read = await readCoderabbitYield({
    graphql,
    progress: (line) => {
      deps.writeDiagnostic(line);
    },
    selection: { author, repos: args.repos, ...window },
  });
  if (read.isErr()) {
    deps.writeDiagnostic(`github coderabbit-yield: the read failed, so no numbers are printed — ${read.error.message}`);
    return EXIT_ERROR;
  }
  const report = coderabbitYieldReport({ prs: read.value.prs, repos: args.repos });
  const facts: YieldReadFacts = {
    author,
    cost: read.value.cost,
    gaps: read.value.gaps,
    readFinishedAtIso: deps.now().toISOString(),
    readStartedAtIso: started.toISOString(),
    repos: args.repos,
    requests: read.value.requests,
    ...window,
  };
  emit({ deps, facts, json: args.json, report });
  return read.value.gaps.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/** `slopweaver github coderabbit-yield`. */
export const githubCoderabbitYieldCommand = defineCommand({
  run: (argv) =>
    runGithubCoderabbitYield({
      deps: {
        graphql: ({ home }) => githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }),
        now: () => new Date(),
        writeDiagnostic: (line) => {
          logger.warn({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
