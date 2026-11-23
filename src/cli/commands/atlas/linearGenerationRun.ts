/**
 * The two `atlas linear` verbs that touch only the published generation, dispatched by the registry rows in
 * `atlas/linear/registration.ts`.
 *
 * `report` reads the published generation and prints where the two surfaces disagree, making no network
 * call at all; `reset` archives the current generation and installs a fresh, empty one. Neither reads
 * Linear nor drives a browser: `sync` and `walk`, which do both, live in `./linearRun.ts`.
 */
import { resetLinearAtlas } from "../../../atlas/linear/reset.js";
import { linearAtlasPaths, readLinearAtlas } from "../../../atlas/linear/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { apiBrowserDisagreements, LINEAR_VERB_USAGE, parsed } from "./linearCore.js";

/** Write each failure line to stderr, one `logger.error` per line, in order. */
export function printErrors({ errors }: { errors: readonly string[] }): void {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
}

/** Run `report`: read the published generation and print where the two surfaces disagree. No network. */
function runReport({ argv }: { argv: readonly string[] }): number {
  const { parsedFlags, rest } = parsed({ argv, verb: "report" });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LINEAR_VERB_USAGE.report });
    return EXIT_OK;
  }
  if (parsedFlags.isErr()) {
    printErrors({ errors: parsedFlags.error });
    return EXIT_USAGE;
  }
  const { values, flags } = parsedFlags.value;
  const paths = linearAtlasPaths({ home: resolveHome({ named: values["home"] }) });
  const snapshot = readLinearAtlas({ paths });
  if (snapshot.isErr()) {
    printErrors({ errors: snapshot.error });
    return EXIT_ERROR;
  }
  const gaps = apiBrowserDisagreements({ snapshot: snapshot.value });
  if (flags.has("json")) {
    logger.out({ line: JSON.stringify({ disagreements: gaps }, null, 2) });
    return EXIT_OK;
  }
  if (gaps.length === 0) {
    logger.out({
      line: "linear atlas: no api-browser disagreement is recorded. A browser surface that has never been filled reports none, which is not the same as agreement — check `atlas linear coverage`",
    });
    return EXIT_OK;
  }
  logger.out({ line: `linear atlas: ${String(gaps.length)} open api-browser disagreement(s)` });
  gaps.forEach((gap) => {
    logger.out({ line: `  ${gap.scope}: ${gap.reason}` });
    logger.out({ line: `    ${gap.fields.slice(0, 12).join(", ")}` });
  });
  return EXIT_OK;
}

/** Run `reset`: archive the current generation and install a fresh, empty one. */
function runReset({ argv }: { argv: readonly string[] }): number {
  const { parsedFlags, rest } = parsed({ argv, verb: "reset" });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LINEAR_VERB_USAGE.reset });
    return EXIT_OK;
  }
  if (parsedFlags.isErr()) {
    printErrors({ errors: parsedFlags.error });
    return EXIT_USAGE;
  }
  const { values, flags } = parsedFlags.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "atlas linear reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    return EXIT_USAGE;
  }
  const paths = linearAtlasPaths({ home: resolveHome({ named: values["home"] }) });
  const result = resetLinearAtlas({ at: new Date().toISOString(), paths });
  if (result.isErr()) {
    printErrors({ errors: result.error });
    return EXIT_ERROR;
  }
  if (flags.has("json")) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `linear atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

/**
 * `atlas linear report` — where the two surfaces disagree, from the published generation, no network.
 *
 * @internal
 */
export const linearReportCommand = defineCommand({ run: (argv) => runReport({ argv }) });

/**
 * `atlas linear reset` — archive the current generation and install a fresh, empty one.
 *
 * @internal
 */
export const linearResetCommand = defineCommand({ run: (argv) => runReset({ argv }) });
