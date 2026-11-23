/**
 * `slopweaver atlas vanta sync [--json] [--home <dir>]` — pull the five Manage API kinds and merge them into the
 * local Vanta atlas. A thin shell over `atlas/vanta/sync.ts`'s `syncVantaAtlas`: this verb owns flags, the
 * real credential/transport/client wiring, and reporting; the domain function owns the merge mechanics.
 *
 * ## The exit-code contract
 *
 * | situation                                                              | code |
 * | ------------------------------------------------------------------------ | ---- |
 * | a bad flag                                                              | `2`  |
 * | credentials genuinely not configured                                    | `3`  |
 * | a LIVE holder has the sync lock — not yet, so a scheduled slot is given back | `4`  |
 * | a hard refusal — an unreadable lock, an untrusted generation, a publish failure | `1`  |
 * | credentials configured, but at least one kind synced incompletely       | `1`  |
 * | every attempted kind synced completely                                  | `0`  |
 */
import { syncVantaAtlasLive } from "../../../atlas/vanta/liveSync.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  exitCodeForVantaSyncError,
  exitCodeForVantaSyncReport,
  parseVantaVerbOptions,
  renderVantaSyncLines,
} from "./core.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's atlas-sync dependency for every CLI invocation, not just
 * this verb's.
 */
export const VANTA_SYNC_USAGE = "usage: slopweaver atlas vanta sync [--json] [--home <dir>]";

/**
 * Run the `vanta sync` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runVantaSync(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_SYNC_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaVerbOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: VANTA_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = parsed.value;
  const result = await syncVantaAtlasLive({ at: new Date().toISOString(), env: process.env, home });
  if (result.isErr()) {
    result.error.lines.forEach((line) => {
      logger.error({ msg: line });
    });
    return exitCodeForVantaSyncError({ error: result.error, exitDeferred: EXIT_DEFERRED, exitError: EXIT_ERROR });
  }

  if (json) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    for (const line of renderVantaSyncLines({ report: result.value })) {
      logger.out({ line });
    }
  }
  return exitCodeForVantaSyncReport({
    exitError: EXIT_ERROR,
    exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
    exitOk: EXIT_OK,
    report: result.value,
  });
}

export const vantaSyncCommand = defineCommand({ run: runVantaSync });
