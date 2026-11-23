/**
 * `slopweaver onepassword reset --confirm archive [--json] [--home <dir>]` — archive the whole current
 * 1Password atlas generation and install a fresh, empty one. Nothing is ever deleted; `--confirm archive`
 * is required so a bare `slopweaver onepassword reset` cannot archive a generation by accident.
 */
import { resetOnepasswordAtlas } from "../../../atlas/onepassword/reset.js";
import { onepasswordAtlasPaths } from "../../../atlas/onepassword/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's atlas dependency for every CLI invocation.
 */
export const ONEPASSWORD_RESET_USAGE = "usage: slopweaver onepassword reset --confirm archive [--json] [--home <dir>]";

/**
 * Run the `onepassword reset` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runOnepasswordReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ONEPASSWORD_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: ONEPASSWORD_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "onepassword reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    logger.error({ msg: ONEPASSWORD_RESET_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: values["home"] });

  const result = resetOnepasswordAtlas({ at: new Date().toISOString(), paths: onepasswordAtlasPaths({ home }) });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }

  if (flags.has("json")) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `1Password atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const onepasswordResetCommand = defineCommand({ run: runOnepasswordReset });
