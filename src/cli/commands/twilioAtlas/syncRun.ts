/**
 * `slopweaver atlas twilio sync [--json] [--home <dir>]` — compile Twilio's own published API definitions
 * into the atlas's `api` and `method` kinds.
 *
 * ## It reaches the network, and what it reaches is not the account
 *
 * `raw.githubusercontent.com/twilio/twilio-oai/...` is Twilio's own PUBLIC repository of the definitions
 * its SDKs are generated from: no credential, nothing about this installation, the same documents any
 * reader of the SDK source is served. So this is not a doored provider read — it writes only under
 * `$SLOPWEAVER_HOME` and asks Twilio nothing about the account. The half of this atlas that DOES ask about
 * the account is the one with no credential, and its coverage cells say so.
 *
 * Every document is checked against the digest in `generated/specLock.ts`, and one whose bytes have moved
 * under its pinned tag is compiled and REPORTED rather than refused — `atlas/twilio/errors.ts` carries the
 * reasoning, and the movement is the more interesting output either way.
 */
import { httpSpecTransport } from "../../../atlas/twilio/specFetch.js";
import { twilioAtlasPaths } from "../../../atlas/twilio/store.js";
import { syncTwilioSpecSurface, type TwilioSyncOutcome } from "../../../atlas/twilio/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Twilio atlas verb sits: past the runtime, the script, the `atlas` noun and the `twilio` platform. */
const TWILIO_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const TWILIO_SYNC_USAGE = "usage: slopweaver atlas twilio sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the sync published, leading with the fraction rather than with a total. */
function report({ asJson, outcome }: { asJson: boolean; outcome: TwilioSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  logger.out({
    line:
      `twilio definition surface — ${String(outcome.specsCompiled)} of ${String(outcome.specsDeclared)} ` +
      `pinned definition(s) compiled, ${String(outcome.methodCount)} distinct operation(s) from ` +
      `${String(outcome.operationCount)} declaration(s) across ${String(outcome.hostCount)} origin(s)`,
  });
  logger.out({
    line:
      `  ${String(outcome.shapeIndexedCount)} operation(s) shape-indexed — message and call logs and every ` +
      "other time-series family, mapped in full and never stored a row per record",
  });
  if (outcome.specsFailed.length > 0) {
    logger.out({ line: `  unread: ${outcome.specsFailed.join(", ")} — each carries its own gap` });
  }
  if (outcome.specsDrifted.length > 0) {
    logger.out({
      line: `  moved under their pinned tag: ${outcome.specsDrifted.join(", ")} — compiled, and each carries its own gap`,
    });
  }
}

/**
 * Run the Twilio definition-surface sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function twilioAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: TWILIO_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TWILIO_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: TWILIO_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const published = await syncTwilioSpecSurface({
    at: new Date().toISOString(),
    paths: twilioAtlasPaths({ home }),
    transport: httpSpecTransport,
  });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return EXIT_OK;
}
