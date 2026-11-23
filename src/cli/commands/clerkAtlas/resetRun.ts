/**
 * `slopweaver atlas clerk reset --confirm archive [--json] [--home <dir>]` — archive the current generation
 * and install a fresh, empty one.
 *
 * `--confirm archive` is required and is the whole guard: this is the only verb in the noun that makes the
 * atlas forget, and the word names what actually happens — nothing is deleted, the generation is moved
 * under `atlas/_superseded/clerk/`.
 */
import { resetClerkAtlas } from "../../../atlas/clerk/reset.js";
import { clerkAtlasPaths } from "../../../atlas/clerk/store.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import { atlasCommandErrorLines } from "../atlas/errors.js";
import { parseAtlasResetOptions } from "../atlas/resetOptions.js";

/** Where a Clerk atlas verb sits: past the runtime, the script, the `atlas` noun and the `clerk` platform. */
const CLERK_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const CLERK_RESET_USAGE = "usage: slopweaver atlas clerk reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Clerk atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function clerkAtlasResetCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: CLERK_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CLERK_RESET_USAGE });
    return EXIT_OK;
  }
  const options = parseAtlasResetOptions({ rest });
  if (options.isErr()) {
    atlasCommandErrorLines({ error: options.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: CLERK_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const outcome = resetClerkAtlas({ at: new Date().toISOString(), paths: clerkAtlasPaths({ home }) });
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
  logger.out({ line: `clerk atlas reset — the prior generation is archived at ${outcome.value.archivedTo}` });
  return EXIT_OK;
}
