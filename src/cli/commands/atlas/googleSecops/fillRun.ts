/**
 * `slopweaver atlas google-secops fill [--json] [--home <dir>]` — read the configured SecOps instance under
 * the stored `chronicle.readonly` grant and publish what it is configured with.
 *
 * Every call is a GET through `live/googleSecops/transport.ts`, which can express nothing else, to the
 * instance's own regional host. Six lists are called (`atlas/googleSecops/fill/plan.ts` says which and why
 * not the rest); every item is kept as allowlisted fields, so a feed's credential, a data table's rows and a
 * dashboard's queries never reach the store.
 */
import { type GoogleSecopsFillObservation, runGoogleSecopsFill } from "../../../../atlas/googleSecops/fill/run.js";
import { type GoogleSecopsSyncReport, syncGoogleSecopsAtlas } from "../../../../atlas/googleSecops/sync.js";
import { logger } from "../../../../lib/logger.js";
import { scopeIdForToken } from "../../../../lib/providerCall.js";
import { resolveGoogleSecopsClient } from "../../../../live/googleSecops/client.js";
import { resolveSecopsInstance } from "../../../../live/googleSecops/instance.js";
import { secopsGet } from "../../../../live/googleSecops/transport.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `google-secops` platform. */
const GOOGLE_SECOPS_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the registration's own copy.
 * @internal
 */
export const GOOGLE_SECOPS_FILL_USAGE = "usage: slopweaver atlas google-secops fill [--json] [--home <dir>]";

/**
 * Run the `atlas google-secops fill` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runGoogleSecopsFillVerb(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: GOOGLE_SECOPS_VERB_INDEX, verbs: ["fill"] });
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: GOOGLE_SECOPS_FILL_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.values["home"] });
  const instance = resolveSecopsInstance({ home });
  if (instance.isErr()) {
    logger.error({ msg: instance.error.message });
    return EXIT_ERROR;
  }
  const bound = resolveGoogleSecopsClient({ capabilities: ["chronicle"], home });
  if (bound.isErr()) {
    logger.error({ msg: bound.error.message });
    return EXIT_ERROR;
  }
  const { account, client } = bound.value;
  const scopeId = scopeIdForToken({ token: account });
  const fill = await runGoogleSecopsFill({
    at: new Date().toISOString(),
    get: ({ url }) => secopsGet({ client, scopeId, url }),
    instance: instance.value,
  });
  const published = syncGoogleSecopsAtlas({ fill, home });
  if (published.isErr()) {
    published.error.forEach((reason) => {
      logger.error({ msg: `google-secops atlas fill: publish refused — ${reason}` });
    });
    for (const failure of fill.failed) {
      logger.warn({ msg: `${failure.rpc} answered ${String(failure.status)} — ${failure.message}` });
    }
    return EXIT_ERROR;
  }
  printFillReport({ fill, json: parsed.value.flags.has("json"), report: published.value });
  return EXIT_OK;
}

/**
 * Print what one fill read and published, as a JSON document or as lines for a reader.
 *
 * @param fill what the run brought back
 * @param report what the publish wrote
 * @param json whether `--json` was passed
 */
function printFillReport({
  fill,
  report,
  json,
}: {
  fill: GoogleSecopsFillObservation;
  report: GoogleSecopsSyncReport;
  json: boolean;
}): void {
  if (json) {
    logger.out({
      line: JSON.stringify(
        {
          answered: fill.answered.map((entry) => ({
            items: entry.items.length,
            rpc: entry.rpc,
            truncated: entry.truncated,
          })),
          entitiesByKind: report.entitiesByKind,
          failed: fill.failed.map((entry) => ({ message: entry.message, rpc: entry.rpc, status: entry.status })),
          filledAtIso: fill.filledAtIso,
        },
        undefined,
        2,
      ),
    });
    return;
  }
  const items = fill.answered.reduce((total, entry) => total + entry.items.length, 0);
  logger.out({
    line: `google-secops atlas fill — ${String(fill.answered.length)} of ${String(fill.answered.length + fill.failed.length)} list(s) answered, ${String(items)} item(s) stored`,
  });
  for (const failure of fill.failed) {
    logger.warn({ msg: `${failure.rpc} answered ${String(failure.status)} — ${failure.message}` });
  }
  logger.out({
    line: "items keep allowlisted fields only, never a feed's settings or a table's rows — run `slopweaver atlas google-secops coverage` for each kind's cells",
  });
}

export const googleSecopsFillCommand = defineCommand({ run: runGoogleSecopsFillVerb });
