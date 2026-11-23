/**
 * `slopweaver atlas braze report [--json] [--home <dir>]` — where Braze's two published descriptions of its
 * own API disagree.
 *
 * Read-only over the local generation: no network call, no credential, no door. The verb reports and never
 * adjudicates — `atlas/braze/report.ts` carries the owner's ruling on why.
 */
import { type BrazeReport, brazeItemisedGapCount, reportBrazeDisagreements } from "../../../atlas/braze/report.js";
import { brazeAtlasPaths } from "../../../atlas/braze/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `braze` platform. */
const BRAZE_VERB_INDEX = 4;

/** How many rows of each disagreement are printed before the rest are counted. */
const ROWS_SHOWN = 12;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const BRAZE_REPORT_USAGE = "usage: slopweaver atlas braze report [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print one itemised group, eliding the tail rather than dropping it silently. */
function printGroup({ title, rows }: { title: string; rows: readonly { readonly providerId: string }[] }): void {
  logger.out({ line: `${title}: ${String(rows.length)}` });
  for (const row of rows.slice(0, ROWS_SHOWN)) {
    logger.out({ line: `    ${row.providerId}` });
  }
  if (rows.length > ROWS_SHOWN) {
    logger.out({ line: `    … and ${String(rows.length - ROWS_SHOWN)} more — use --json for all of them` });
  }
}

/** Print the report. */
function report({ asJson, value }: { asJson: boolean; value: BrazeReport }): void {
  if (asJson) {
    logger.out({ line: safeJsonStringify({ label: "the braze disagreement report", space: 1, value }) });
    return;
  }
  logger.out({
    line: `braze — ${String(brazeItemisedGapCount({ report: value }))} disagreement(s) between Braze's own published sources`,
  });
  printGroup({ rows: value.missingFromCollection, title: "  documented, absent from the official collection" });
  printGroup({ rows: value.missingFromDocumentation, title: "  shipped by the collection, undocumented" });
  printGroup({ rows: value.malformedPaths, title: "  addresses published in a form that does not resolve" });
  for (const family of value.familiesAbsentFromCollection) {
    logger.out({
      line: `  the collection ships NONE of the ${String(family.operations)} operation(s) in \`${family.kind}\``,
    });
  }
  for (const other of value.otherOpenGaps) {
    logger.out({ line: `  ${other.condition}: ${String(other.count)} open` });
  }
}

/**
 * Report where the two published surfaces disagree.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function brazeAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: BRAZE_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: BRAZE_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: BRAZE_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const found = reportBrazeDisagreements({ paths: brazeAtlasPaths({ home: options.value.home }) });
  if (found.isErr()) {
    found.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson: options.value.json, value: found.value });
  return EXIT_OK;
}
