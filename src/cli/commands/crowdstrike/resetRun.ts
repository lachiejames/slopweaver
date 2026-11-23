/**
 * `slopweaver crowdstrike reset --confirm archive [--json] [--home <dir>]` — archive the whole current
 * CrowdStrike atlas generation and install a fresh, empty one. Nothing is ever deleted; `--confirm archive`
 * is required so a bare `slopweaver crowdstrike reset` cannot archive a generation by accident.
 */
import { resetCrowdstrikeAtlas } from "../../../atlas/crowdstrike/reset.js";
import { crowdstrikeAtlasPaths } from "../../../atlas/crowdstrike/store.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { CROWDSTRIKE_RESET_USAGE, parseCrowdstrikeResetOptions } from "./core.js";
import { crowdstrikeVerbErrorLines } from "./errors.js";

/**
 * Run the `crowdstrike reset` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runCrowdstrikeReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CROWDSTRIKE_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCrowdstrikeResetOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    for (const line of crowdstrikeVerbErrorLines({ error: parsed.error })) {
      logger.error({ msg: line });
    }
    logger.error({ msg: CROWDSTRIKE_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = parsed.value;

  const result = resetCrowdstrikeAtlas({ at: new Date().toISOString(), paths: crowdstrikeAtlasPaths({ home }) });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }

  if (json) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `CrowdStrike atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const crowdstrikeResetCommand = defineCommand({ run: runCrowdstrikeReset });
