/**
 * `slopweaver atlas make fill [--json] [--home <dir>]` — read the owner's Make organisation under their own
 * token and publish every scenario, team, folder, connection, hook and newest run it can see.
 *
 * Every call goes through `atlas/make/client.ts`, whose SDK subclass refuses any method but GET and any URL
 * off the configured zone before a request leaves the process: nothing in Make is changed or run. The fill is
 * all-or-nothing (`atlas/make/fill/run.ts`), so a failed read publishes nothing rather than a partial
 * organisation.
 *
 * A missing token exits `EXIT_EXPECTED_EMPTY`: a prerequisite absent, not a fault. The message names where
 * the token is minted and the two secrets it goes in; this verb never mints one.
 */
import { createMakeRead } from "../../../../atlas/make/client.js";
import { resolveMakeCredential } from "../../../../atlas/make/credential.js";
import { type MakeFillObservation, runMakeFill } from "../../../../atlas/make/fill/run.js";
import { type MakeSyncReport, syncMakeAtlas } from "../../../../atlas/make/sync.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `make` platform. */
const MAKE_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the registration's own copy.
 * @internal
 */
export const MAKE_FILL_USAGE = "usage: slopweaver atlas make fill [--json] [--home <dir>]";

/**
 * Run the `atlas make fill` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runMakeFillVerb(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: MAKE_VERB_INDEX, verbs: ["fill"] });
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: MAKE_FILL_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.values["home"] });
  const credential = resolveMakeCredential({ home });
  if (credential.isErr()) {
    logger.error({ msg: credential.error.message });
    return credential.error.code === "CREDENTIAL_MISSING" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }
  const fill = await runMakeFill({ at: new Date().toISOString(), read: createMakeRead(credential.value) });
  if (fill.isErr()) {
    logger.error({ msg: `make atlas fill: nothing published — ${fill.error.message}` });
    return EXIT_ERROR;
  }
  const published = syncMakeAtlas({ fill: fill.value, home });
  if (published.isErr()) {
    published.error.forEach((reason) => {
      logger.error({ msg: `make atlas fill: publish refused — ${reason}` });
    });
    return EXIT_ERROR;
  }
  printFillReport({ fill: fill.value, json: parsed.value.flags.has("json"), report: published.value });
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
  fill: MakeFillObservation;
  report: MakeSyncReport;
  json: boolean;
}): void {
  if (json) {
    logger.out({
      line: JSON.stringify(
        { entitiesByKind: report.entitiesByKind, filledAtIso: fill.filledAtIso, reached: fill.reached },
        undefined,
        2,
      ),
    });
    return;
  }
  const counts = report.entitiesByKind.map((entry) => `${String(entry.entities)} ${entry.kind}`).join(", ");
  logger.out({ line: `make atlas fill — ${counts}; ${String(fill.reached.length)} read kinds answered` });
  logger.out({
    line: "GET only, nothing in Make changed or run — `slopweaver atlas make render` draws the scenario table",
  });
}

export const makeFillCommand = defineCommand({ run: runMakeFillVerb });
