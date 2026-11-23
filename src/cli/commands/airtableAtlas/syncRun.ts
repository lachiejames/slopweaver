/**
 * `slopweaver atlas airtable sync [--json] [--home <dir>]` — publish both compiled surface maps and the
 * honest coverage for every kind neither of them fills.
 *
 * No network call at all: the subjects are Airtable's own OpenAPI document, generated into a committed
 * registry and pinned by digest, and a browser route inventory measured without an account. So this is
 * local-state rather than external-read, and it is what lets this atlas exist on an installation that holds
 * no Airtable membership.
 */
import { airtableAtlasPaths } from "../../../atlas/airtable/store.js";
import { type AirtableSyncOutcome, syncAirtableSurfaces } from "../../../atlas/airtable/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where an Airtable atlas verb sits: past the runtime, the script, `atlas` and the `airtable` platform. */
const AIRTABLE_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const AIRTABLE_SYNC_USAGE = "usage: slopweaver atlas airtable sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: AirtableSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  logger.out({
    line:
      `airtable surface maps — ${String(outcome.operationCount)} declared operation(s) and ` +
      `${String(outcome.routeCount)} browser route(s), ${String(outcome.confirmedRouteCount)} of them ` +
      `confirmed to exist; ${String(outcome.unreachableKindCount)} entity kind(s) report not-configured`,
  });
}

/**
 * Run the Airtable surface-map sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function airtableAtlasSyncCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: AIRTABLE_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: AIRTABLE_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: AIRTABLE_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = syncAirtableSurfaces({ at: new Date().toISOString(), paths: airtableAtlasPaths({ home }) });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return EXIT_OK;
}
