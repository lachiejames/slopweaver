/**
 * `slopweaver atlas xero report [--json] [--home <dir>]` — the corroboration between the two surfaces.
 *
 * A pure read of local state: no network call and no browser. The judgement itself is
 * `atlas/xero/disagreement.ts`, so what is here is the shell.
 */
import { splitXeroChannels, summariseDisagreement } from "../../../atlas/xero/disagreement.js";
import { readXeroKindFile, xeroAtlasPaths } from "../../../atlas/xero/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Xero atlas verb sits: past the runtime, the script, the `atlas` noun and the `xero` platform. */
const XERO_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const XERO_REPORT_USAGE = "usage: slopweaver atlas xero report [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Report where the two Xero surfaces disagree.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function xeroAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: XERO_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: XERO_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: XERO_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const file = readXeroKindFile({ kind: "method", paths: xeroAtlasPaths({ home }) });
  if (file.isErr()) {
    file.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (file.value === null) {
    logger.error({ msg: "the xero atlas holds no method generation yet — run `slopweaver atlas xero refresh`" });
    return EXIT_ERROR;
  }
  const split = splitXeroChannels({ entities: file.value.entities });
  if (asJson) {
    logger.out({ line: JSON.stringify(split, null, 1) });
    return EXIT_OK;
  }
  for (const line of summariseDisagreement({ split })) {
    logger.out({ line });
  }
  return EXIT_OK;
}
