/**
 * `slopweaver atlas inngest sync [--json] [--home <dir>]` — compile the published catalogue and the
 * dashboard's own route table, probe both, and publish a generation.
 *
 * Every document this reads is one Inngest serves any reader, and every request it sends is a GET carrying
 * no credential. So it reaches the PRODUCT rather than this account, writes only under `$SLOPWEAVER_HOME`,
 * and is `local-state` rather than external-read.
 */
import { httpInngestSyncDeps, type InngestSyncOutcome, syncInngestAtlas } from "../../../atlas/inngest/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, `atlas` and the `inngest` platform. */
const INNGEST_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const INNGEST_SYNC_USAGE = "usage: slopweaver atlas inngest sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: InngestSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  logger.out({
    line:
      `inngest — ${String(outcome.operationCount)} published REST operation(s); ` +
      `${String(outcome.pageCount)} dashboard route(s) from the application's own table, ` +
      `${String(outcome.routesProbed)} of them probed; ${String(outcome.gapCount)} gap(s) recorded`,
  });
  outcome.probeNotes.forEach((line) => {
    logger.out({ line: `  control: ${line}` });
  });
}

/**
 * Run the Inngest sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function inngestAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: INNGEST_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: INNGEST_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: INNGEST_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = await syncInngestAtlas({ at: new Date().toISOString(), deps: httpInngestSyncDeps(), home });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return EXIT_OK;
}
