/**
 * `slopweaver atlas twilio report [--json] [--home <dir>]` — print where Twilio's two surfaces disagree.
 *
 * No network call and no browser: it reads the published generation and prints what is already in it. It
 * RESOLVES NOTHING, which is the owner's ruling rather than a limitation — which surface wins when two
 * disagree is a decision reserved for the owner until they can see real instances, so this verb's whole job is to
 * put those instances in front of them.
 */
import { reportTwilioDisagreements, type TwilioReport } from "../../../atlas/twilio/report.js";
import { readTwilioAtlas, twilioAtlasPaths } from "../../../atlas/twilio/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Twilio atlas verb sits: past the runtime, the script, the `atlas` noun and the `twilio` platform. */
const TWILIO_VERB_INDEX = 4;

/** How many disagreements of one class are printed before the rest are counted. */
const PRINTED_PER_KIND = 20;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const TWILIO_REPORT_USAGE = "usage: slopweaver atlas twilio report [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * The lines the report prints, headline first.
 *
 * @param report what the pure pass found
 * @returns the lines, in print order
 *
 * @internal
 */
export function renderTwilioReport({ report }: { report: TwilioReport }): readonly string[] {
  const lines = [
    `twilio surfaces — ${String(report.specKnown)} operation(s) known to the definitions, ` +
      `${String(report.browserKnown)} to the console`,
  ];
  if (report.unmeasurableBecause !== null) {
    lines.push(`  no disagreement is computable: ${report.unmeasurableBecause}`);
    return lines;
  }
  for (const kind of ["browser-only", "field-divergence", "spec-only"] as const) {
    const found = report.disagreements.filter((row) => row.kind === kind);
    if (found.length === 0) {
      continue;
    }
    lines.push(`  ${kind}: ${String(found.length)}`);
    for (const row of found.slice(0, PRINTED_PER_KIND)) {
      const fields = row.fields.length === 0 ? "" : ` — fields: ${row.fields.join(", ")}`;
      lines.push(`    ${row.providerId}${fields}`);
    }
    if (found.length > PRINTED_PER_KIND) {
      lines.push(`    … and ${String(found.length - PRINTED_PER_KIND)} more; --json prints every one`);
    }
  }
  if (report.disagreements.length === 0) {
    lines.push("  the two surfaces agree on every operation either of them knows");
  }
  return lines;
}

/**
 * Print where the two surfaces disagree.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function twilioAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: TWILIO_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TWILIO_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: TWILIO_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const snapshot = readTwilioAtlas({ paths: twilioAtlasPaths({ home: options.value.home }) });
  if (snapshot.isErr()) {
    snapshot.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const report = reportTwilioDisagreements({ methods: snapshot.value.files.method });
  if (options.value.json) {
    logger.out({ line: JSON.stringify(report, null, 1) });
    return EXIT_OK;
  }
  for (const line of renderTwilioReport({ report })) {
    logger.out({ line });
  }
  return EXIT_OK;
}
