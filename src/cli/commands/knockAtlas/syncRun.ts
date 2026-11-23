/**
 * `slopweaver atlas knock sync [--json] [--home <dir>]` — publish both compiled surface maps and the honest
 * coverage for every kind neither fills.
 *
 * No network call at all: the subjects are Knock's two published OpenAPI documents and the dashboard's own
 * route table, generated into committed registries and pinned by digest. So this is local-state rather than
 * external-read, and it is what lets this atlas exist on an installation that holds no Knock credential.
 */
import { knockAtlasPaths } from "../../../atlas/knock/store.js";
import { type KnockSyncOutcome, syncKnockAtlas } from "../../../atlas/knock/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, `atlas` and the `knock` platform. */
const KNOCK_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const KNOCK_SYNC_USAGE = "usage: slopweaver atlas knock sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: KnockSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  logger.out({
    line:
      `knock surface maps — ${String(outcome.methods)} declared operation(s) across both published APIs, ` +
      `${String(outcome.routes)} dashboard route(s); ${String(outcome.unconfiguredKinds)} entity kind(s) ` +
      `report not-configured, ${String(outcome.gapsDetected)} gap(s) open`,
  });
}

/**
 * Run the Knock surface-map sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function knockAtlasSyncCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: KNOCK_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: KNOCK_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: KNOCK_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = syncKnockAtlas({ at: new Date().toISOString(), paths: knockAtlasPaths({ home }) });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return EXIT_OK;
}
