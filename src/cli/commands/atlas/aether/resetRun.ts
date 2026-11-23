/**
 * `slopweaver atlas aether reset --confirm archive [--json] [--home <dir>]` — archive the whole current
 * Aether atlas and install a fresh, empty generation.
 *
 * Nothing is ever deleted; `--confirm archive` is required so a bare `reset` cannot archive a generation by
 * accident. The page screenshots go with the archive, because a proof that outlives the generation it
 * belongs to is a picture nobody can date.
 */
import { resetAetherAtlas } from "../../../../atlas/aether/reset.js";
import { aetherAtlasPaths } from "../../../../atlas/aether/store.js";
import { slopweaverHome } from "../../../../homeDir.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, verbTail } from "../../../optionParsers.js";

/** Where an Aether verb sits: past the runtime, the script, the `atlas` noun and the `aether` platform. */
const AETHER_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const AETHER_RESET_USAGE = "usage: slopweaver atlas aether reset --confirm archive [--json] [--home <dir>]";

/**
 * Run the `atlas aether reset` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export function runAetherReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: AETHER_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: AETHER_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: AETHER_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "atlas aether reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    logger.error({ msg: AETHER_RESET_USAGE });
    return EXIT_USAGE;
  }
  let home = slopweaverHome();
  const homeFlag = values["home"];
  if (homeFlag !== undefined) {
    home = homeFlag;
  }
  const result = resetAetherAtlas({ at: new Date().toISOString(), paths: aetherAtlasPaths({ home }) });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  if (flags.has("json")) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `aether atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const aetherResetCommand = defineCommand({ run: runAetherReset });
