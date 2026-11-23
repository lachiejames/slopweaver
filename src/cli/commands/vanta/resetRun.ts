/**
 * `slopweaver atlas vanta reset --confirm archive [--json] [--home <dir>]` — archive the whole current Vanta
 * atlas and install a fresh, empty generation. Nothing is ever deleted; `--confirm archive` is required
 * so a bare `slopweaver atlas vanta reset` cannot archive a generation by accident.
 */
import { resetVantaAtlas } from "../../../atlas/vanta/reset.js";
import { vantaAtlasPaths } from "../../../atlas/vanta/store.js";
import { logger } from "../../../lib/logger.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's atlas-reset dependency for every CLI invocation, not
 * just this verb's.
 */
export const VANTA_RESET_USAGE = "usage: slopweaver atlas vanta reset --confirm archive [--json] [--home <dir>]";

/**
 * Run the `vanta reset` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runVantaReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: VANTA_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "vanta reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    logger.error({ msg: VANTA_RESET_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: values["home"] });
  const json = flags.has("json");

  const paths = vantaAtlasPaths({ home });
  const result = resetVantaAtlas({ at: new Date().toISOString(), paths });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }

  if (json) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `vanta atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const vantaResetCommand = defineCommand({ run: runVantaReset });
