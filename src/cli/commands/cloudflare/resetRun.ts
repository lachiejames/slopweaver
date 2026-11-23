/**
 * `slopweaver cloudflare reset --confirm archive [--json] [--home <dir>]` — archive the whole current
 * Cloudflare atlas and install a fresh, empty generation. Nothing is ever deleted; `--confirm archive` is
 * required so a bare `slopweaver cloudflare reset` cannot archive a generation by accident.
 */
import { resetCloudflareAtlas } from "../../../atlas/cloudflare/reset.js";
import { cloudflareAtlasPaths } from "../../../atlas/cloudflare/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's atlas-reset dependency for every CLI invocation, not
 * just this verb's.
 */
export const CLOUDFLARE_RESET_USAGE = "usage: slopweaver cloudflare reset --confirm archive [--json] [--home <dir>]";

/**
 * Run the `cloudflare reset` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runCloudflareReset(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CLOUDFLARE_RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CLOUDFLARE_RESET_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    logger.error({
      msg: "cloudflare reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
    });
    logger.error({ msg: CLOUDFLARE_RESET_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: values["home"] });
  const json = flags.has("json");

  const paths = cloudflareAtlasPaths({ home });
  const result = resetCloudflareAtlas({ at: new Date().toISOString(), paths });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }

  if (json) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    logger.out({ line: `cloudflare atlas reset — archived the prior generation to ${result.value.archivedTo}` });
  }
  return EXIT_OK;
}

export const cloudflareResetCommand = defineCommand({ run: runCloudflareReset });
