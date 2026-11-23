/**
 * `slopweaver atlas xero reset --confirm archive [--json] [--home <dir>]` — archive the current generation
 * and install a fresh, empty one.
 *
 * `--confirm archive` is required and is the whole guard: this is the only verb in the noun that makes the
 * atlas forget, and the word names what actually happens — nothing is deleted, the generation is moved under
 * `atlas/_superseded/xero/`.
 */
import { resetXeroAtlas } from "../../../atlas/xero/reset.js";
import { xeroAtlasPaths } from "../../../atlas/xero/store.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import { atlasCommandErrorLines } from "../atlas/errors.js";
import { parseAtlasResetOptions } from "../atlas/resetOptions.js";

/** Where a Xero atlas verb sits: past the runtime, the script, the `atlas` noun and the `xero` platform. */
const XERO_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const XERO_RESET_USAGE = "usage: slopweaver atlas xero reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Xero atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function xeroAtlasResetCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: XERO_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: XERO_RESET_USAGE });
    return EXIT_OK;
  }
  const options = parseAtlasResetOptions({ rest });
  if (options.isErr()) {
    atlasCommandErrorLines({ error: options.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: XERO_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const outcome = resetXeroAtlas({ at: new Date().toISOString(), paths: xeroAtlasPaths({ home }) });
  if (outcome.isErr()) {
    outcome.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome.value, null, 1) });
    return EXIT_OK;
  }
  logger.out({ line: `xero atlas reset — the prior generation is archived at ${outcome.value.archivedTo}` });
  return EXIT_OK;
}
