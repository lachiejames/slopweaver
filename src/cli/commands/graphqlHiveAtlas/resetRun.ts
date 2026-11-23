/**
 * `slopweaver atlas graphql-hive reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * Nothing is deleted, and `--confirm archive` is required rather than implied: the word a caller types is
 * the word for what actually happens, so a reader of the command line cannot believe they are wiping
 * something.
 */
import { resetHiveAtlas } from "../../../atlas/graphqlHive/reset.js";
import { hiveAtlasPaths } from "../../../atlas/graphqlHive/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

import { HIVE_VERB_INDEX } from "./syncRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const HIVE_RESET_USAGE = "usage: slopweaver atlas graphql-hive reset --confirm archive [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts, refusing anything but the exact confirmation word. */
function parseResetOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["confirm", "home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  if (parsed.value.values["confirm"] !== "archive") {
    return err(["reset needs --confirm archive — the prior generation is archived, never deleted"]);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Run the GraphQL Hive atlas reset.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function graphqlHiveAtlasResetCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: HIVE_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HIVE_RESET_USAGE });
    return EXIT_OK;
  }
  const options = parseResetOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: HIVE_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const done = resetHiveAtlas({ at: new Date().toISOString(), paths: hiveAtlasPaths({ home }) });
  if (done.isErr()) {
    done.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (asJson) {
    logger.out({ line: JSON.stringify(done.value, null, 1) });
    return EXIT_OK;
  }
  logger.out({ line: `graphql-hive atlas archived to ${done.value.archivedTo}, empty generation installed` });
  return EXIT_OK;
}
