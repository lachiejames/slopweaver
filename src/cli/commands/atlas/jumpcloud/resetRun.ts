/**
 * `slopweaver atlas jumpcloud reset --confirm archive [--json] [--home <dir>]` — archive the whole current
 * JumpCloud atlas and install a fresh, empty generation.
 *
 * Nothing is ever deleted; `--confirm archive` is required so a bare `reset` cannot archive a generation by
 * accident. The resume journal goes with the archive — see `atlas/jumpcloud/reset.ts` for why a journal that
 * outlives its generation is worse than no journal.
 */
import { resetJumpcloudAtlas } from "../../../../atlas/jumpcloud/reset.js";
import { jumpcloudAtlasPaths } from "../../../../atlas/jumpcloud/store.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a JumpCloud verb sits: past the runtime, the script, the `atlas` noun and the `jumpcloud` platform. */
const JUMPCLOUD_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's atlas-reset dependency for every CLI invocation.
 * @internal
 */
export const JUMPCLOUD_RESET_USAGE =
  "usage: slopweaver atlas jumpcloud reset --confirm archive [--json] [--home <dir>]";

/**
 * Run the `atlas jumpcloud reset` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export function runJumpcloudReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: JUMPCLOUD_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: JUMPCLOUD_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: JUMPCLOUD_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "atlas jumpcloud reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    logger.error({ msg: JUMPCLOUD_RESET_USAGE });
    return EXIT_USAGE;
  }
  const paths = jumpcloudAtlasPaths({ home: resolveHome({ named: values["home"] }) });
  const result = resetJumpcloudAtlas({ at: new Date().toISOString(), paths });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  if (flags.has("json")) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `jumpcloud atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const jumpcloudResetCommand = defineCommand({ run: runJumpcloudReset });
