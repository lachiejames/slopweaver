/**
 * The effectful shell for `slopweaver github bottleneck`.
 *
 * It makes NO read of its own. The whole input is `./landingRun.ts`'s `readLandingRows` — the same fleet read
 * `github landing`, `github review-state` and session-start go through — so the audit and the act can never
 * disagree about what a pull request's state is. A second read path here would be a second answer to the
 * same question, which is the exact class of bug the required-context fix on this branch closed.
 *
 * Too many open pull requests means the bottlenecks in the delivery process are the thing to fix.
 * `github landing` answers what holds ONE pull request. This verb
 * groups the backlog by cause, so the biggest bar names the mechanism.
 *
 * **It writes nothing**, so it takes `GithubLandingDeps` whole and touches only the read half of it. That is
 * deliberate rather than lazy: the deps interface is where the read's seams already are, and a narrower
 * interface here would have to be kept in step with it by hand.
 */

import { safeJsonStringify } from "../../../lib/safeJson.js";
import { bottleneckReport } from "../../../review/bottleneck.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type GithubBottleneckArgs, parseGithubBottleneckArgs } from "./bottleneckCore.js";
import { bottleneckDocument, bottleneckLines } from "./bottleneckReport.js";
import { githubBottleneckUsage } from "./bottleneckUsage.js";
import type { GithubLandingArgs } from "./landingCore.js";
import { type GithubLandingDeps, productionGithubLandingDeps, resolveAndReadLandingRows } from "./landingRun.js";

const VERB_ARG_OFFSET = 4;

/**
 * The landing invocation this audit's own flags imply.
 *
 * `includeDrafts` is inverted here, which is the one place the two verbs' defaults genuinely differ. Every
 * write flag is off and stays off: this verb has no path that presses or registers, so the values are
 * constants rather than options.
 *
 * @param args the parsed audit invocation
 * @returns the landing args the shared read takes
 */
function asLandingArgs({ args }: { args: GithubBottleneckArgs }): GithubLandingArgs {
  return {
    author: args.author,
    authoredByOwner: args.author?.toLowerCase() === "@me",
    cadenceMinutes: 0,
    draftsOnly: false,
    dryRun: false,
    full: false,
    home: args.home,
    ifDue: false,
    includeDrafts: !args.excludeDrafts,
    json: true,
    limit: args.limit,
    optOutLabels: [],
    pr: undefined,
    // Neither backlog verb takes `--record-reading`: the readings ledger names a PRODUCER, and both of these
    // print their own document rather than landing's. Giving each one its own producer is a follow-up row.
    recordReadingBy: undefined,
    press: false,
    register: false,
    repos: args.repos,
    slackLive: args.slackLive,
  };
}

/**
 * Run one `github bottleneck` invocation against injected edges.
 *
 * @param rest argv after `github bottleneck`
 * @param deps the landing read's own seams, of which only the read half is touched
 * @returns the process exit code
 */
export async function runGithubBottleneck({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubLandingDeps;
}): Promise<number> {
  const parsed = parseGithubBottleneckArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(githubBottleneckUsage());
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const read = await resolveAndReadLandingRows({ args: asLandingArgs({ args }), deps });
  if (read.isErr()) {
    for (const problem of read.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const nowIso = deps.now().toISOString();
  const report = bottleneckReport({ nowIso, rows: read.value.rows });
  if (args.json) {
    deps.writeOut(
      safeJsonStringify({
        label: "github bottleneck document",
        value: bottleneckDocument({
          author: args.author,
          includedDrafts: !args.excludeDrafts,
          nowIso,
          report,
          repos: read.value.repos,
        }),
      }),
    );
    return EXIT_OK;
  }
  for (const line of bottleneckLines({ report })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/** `slopweaver github bottleneck`. */
export const githubBottleneckCommand = defineCommand({
  run: (argv) => runGithubBottleneck({ deps: productionGithubLandingDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
