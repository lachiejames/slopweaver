/**
 * `slopweaver atlas google-admin reset --confirm archive [--json] [--home <dir>]` — archive the whole
 * current Google Admin atlas and install a fresh, empty generation.
 *
 * Nothing is ever deleted; `--confirm archive` is required so a bare `reset` cannot archive a generation
 * by accident.
 */
import { resetGoogleAdminAtlas } from "../../../../atlas/googleAdmin/reset.js";
import { googleAdminAtlasPaths } from "../../../../atlas/googleAdmin/store.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `google-admin` platform. */
const GOOGLE_ADMIN_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const GOOGLE_ADMIN_RESET_USAGE =
  "usage: slopweaver atlas google-admin reset --confirm archive [--json] [--home <dir>]";

/**
 * Run the `atlas google-admin reset` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export function runGoogleAdminReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: GOOGLE_ADMIN_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: GOOGLE_ADMIN_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: GOOGLE_ADMIN_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "atlas google-admin reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    logger.error({ msg: GOOGLE_ADMIN_RESET_USAGE });
    return EXIT_USAGE;
  }
  const paths = googleAdminAtlasPaths({ home: resolveHome({ named: values["home"] }) });
  const result = resetGoogleAdminAtlas({ at: new Date().toISOString(), paths });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  if (flags.has("json")) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `google-admin atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const googleAdminResetCommand = defineCommand({ run: runGoogleAdminReset });
