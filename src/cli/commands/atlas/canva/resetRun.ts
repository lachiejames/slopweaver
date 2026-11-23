/**
 * `slopweaver atlas canva reset --confirm archive [--json] [--home <dir>]` — archive the whole current
 * Canva atlas and install a fresh, empty generation.
 *
 * Nothing is ever deleted; `--confirm archive` is required so a bare `reset` cannot archive a generation by
 * accident.
 */
import { resetCanvaAtlas } from "../../../../atlas/canva/reset.js";
import { canvaAtlasPaths } from "../../../../atlas/canva/store.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a Canva verb sits: past the runtime, the script, the `atlas` noun and the `canva` platform. */
const CANVA_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const CANVA_RESET_USAGE = "usage: slopweaver atlas canva reset --confirm archive [--json] [--home <dir>]";

/**
 * Run the `atlas canva reset` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export function runCanvaReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: CANVA_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CANVA_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CANVA_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "atlas canva reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    logger.error({ msg: CANVA_RESET_USAGE });
    return EXIT_USAGE;
  }
  const paths = canvaAtlasPaths({ home: resolveHome({ named: values["home"] }) });
  const result = resetCanvaAtlas({ at: new Date().toISOString(), paths });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  if (flags.has("json")) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `canva atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const canvaResetCommand = defineCommand({ run: runCanvaReset });
