/**
 * `slopweaver atlas nightfall reset --confirm archive [--json] [--home <dir>]` — archive the whole current
 * Nightfall atlas and install a fresh, empty generation.
 *
 * Nothing is ever deleted; `--confirm archive` is required so a bare `reset` cannot archive a generation by
 * accident.
 */
import { resetNightfallAtlas } from "../../../../atlas/nightfall/reset.js";
import { nightfallAtlasPaths } from "../../../../atlas/nightfall/store.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a Nightfall verb sits: past the runtime, the script, the `atlas` noun and the `nightfall` platform. */
const NIGHTFALL_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const NIGHTFALL_RESET_USAGE =
  "usage: slopweaver atlas nightfall reset --confirm archive [--json] [--home <dir>]";

/**
 * Run the `atlas nightfall reset` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export function runNightfallReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: NIGHTFALL_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: NIGHTFALL_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: NIGHTFALL_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "atlas nightfall reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    logger.error({ msg: NIGHTFALL_RESET_USAGE });
    return EXIT_USAGE;
  }
  const paths = nightfallAtlasPaths({ home: resolveHome({ named: values["home"] }) });
  const result = resetNightfallAtlas({ at: new Date().toISOString(), paths });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  if (flags.has("json")) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `nightfall atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const nightfallResetCommand = defineCommand({ run: runNightfallReset });
