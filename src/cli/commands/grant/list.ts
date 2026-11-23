/**
 * `slopweaver grant list` — every row this home holds, and what happened to each.
 *
 * The outcome column is the reason this verb exists rather than being a nicety: a row with neither a
 * performance nor a refusal beside it is a decision that reached a session and then went nowhere, which is
 * the silent stall the whole mechanism is built against.
 */
import { grantRowsOf, performancesOf, refusalsOf, renderTarget } from "../../../grants/grant.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { grantUsage, parseGrantListArgs, VERB_ARG_OFFSET } from "./core.js";
import { type GrantCommandDeps, productionGrantCommandDeps, reportGrantStoreError } from "./deps.js";

/**
 * Run `grant list` over the store-backed journal.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runGrantList(argv: readonly string[]): Promise<number> {
  return runGrantListWithDeps({ argv, deps: productionGrantCommandDeps() });
}

/**
 * Run `grant list` over whichever journal it is handed.
 *
 * @param argv the full process argv
 * @param deps the journal port
 * @returns the process exit code — `EXIT_ERROR` when the store could not be read, never "no rows"
 */
export async function runGrantListWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GrantCommandDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: grantUsage({ verb: "list" }) });
    return EXIT_OK;
  }
  const parsed = parseGrantListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: grantUsage({ verb: "list" }) });
    return EXIT_USAGE;
  }
  const { home, json } = parsed.value;
  const read = await deps.journal.readEntries({ home: resolveHome({ named: home }) });
  if (read.isErr()) {
    return reportGrantStoreError({ error: read.error, json, verb: "list" });
  }
  const entries = read.value;
  const performances = performancesOf({ entries });
  const refusals = refusalsOf({ entries });
  const rows = grantRowsOf({ entries }).map((grant) => ({
    grant,
    outcome: outcomeOf({
      performed: performances.some((performance) => performance.grantId === grant.id),
      refusedAs: refusals.findLast((refusal) => refusal.grantId === grant.id)?.code,
    }),
  }));
  if (json) {
    logger.out({ line: JSON.stringify(rows) });
    return EXIT_OK;
  }
  if (rows.length === 0) {
    logger.out({ line: "grant list: no rows recorded in this home's store" });
    return EXIT_OK;
  }
  rows.forEach(({ grant, outcome }) => {
    logger.out({ line: `${grant.id}  ${outcome.padEnd(18)} ${renderTarget({ target: grant.target })}` });
  });
  return EXIT_OK;
}

/** One row's outcome word. `open` is the one worth chasing: nothing has answered it either way. */
function outcomeOf({ performed, refusedAs }: { performed: boolean; refusedAs: string | undefined }): string {
  if (performed) {
    return "performed";
  }
  return refusedAs === undefined ? "open" : `refused:${refusedAs}`;
}

export const grantListCommand = defineCommand({ run: runGrantList });
