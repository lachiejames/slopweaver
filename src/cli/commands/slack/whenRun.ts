/**
 * `slopweaver slack when <ts-or-permalink>…` — the shell around the pure conversion in `whenCore.ts`.
 *
 * Thinner than every other verb's shell because there is nothing effectful to inject: no token, no network,
 * no home. The only edges are the two write channels, kept separate so `--json` stdout stays exactly one
 * document.
 */

import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import { SLACK_WHEN_USAGE } from "./verbUsage.js";
import { parseSlackWhenArgs, renderSlackWhen, slackWhenReport } from "./whenCore.js";

/** The argv index the `slack <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injected write edges, so the shell is testable without capturing the process streams. */
export interface SlackWhenDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run the verb against injected write edges.
 *
 * @param rest the argv tail after `slack when`
 * @param deps the injected write edges
 * @returns the process exit code
 */
export function runSlackWhen({ rest, deps }: { rest: readonly string[]; deps: SlackWhenDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SLACK_WHEN_USAGE);
    return EXIT_OK;
  }
  const options = parseSlackWhenArgs({ rest });
  if (options.isErr()) {
    slackArgumentErrorLines({ error: options.error }).forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(SLACK_WHEN_USAGE);
    return EXIT_USAGE;
  }
  const report = slackWhenReport({ inputs: options.value.inputs });
  if (report.isErr()) {
    report.error.forEach((problem) => {
      deps.writeDiagnostic(`slack when: ${problem}`);
    });
    return EXIT_USAGE;
  }
  deps.writeOut(options.value.json ? JSON.stringify(report.value, null, 2) : renderSlackWhen({ report: report.value }));
  return EXIT_OK;
}

/**
 * The production edges.
 *
 * @returns the production write bag, swapped for plain fakes under test
 */
export function productionSlackWhenDeps(): SlackWhenDeps {
  return {
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver slack when` — the instant a Slack timestamp names, derived rather than guessed. */
export const slackWhenCommand = defineCommand({
  run: (argv) => runSlackWhen({ deps: productionSlackWhenDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
