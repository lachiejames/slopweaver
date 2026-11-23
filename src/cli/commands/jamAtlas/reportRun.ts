/**
 * `slopweaver atlas jam report [--json] [--home <dir>]` — print where this atlas's surfaces disagree.
 *
 * No network call, and it resolves NOTHING. The owner has ruled that what a disagreement means is the owner's call
 * and that the owner wants the instances first (`docs/atlas-intent/04-corroboration.md`), so this verb's whole job is to make
 * them visible: endpoints Jam's own application calls that its published description never declares,
 * integrations published against integrations the application actually names, routes the walk could not
 * open, and landed routes carrying no picture.
 */
import { type JamDisagreementReport, jamDisagreementReport } from "../../../atlas/jam/disagreement.js";
import {
  JAM_INTEGRATION_KIND,
  JAM_OPERATION_KIND,
  JAM_PAGE_KIND,
  type JamAtlasEntity,
  type JamAtlasGap,
  type JamAtlasKindFile,
} from "../../../atlas/jam/model.js";
import { jamAtlasPaths, readJamAtlas } from "../../../atlas/jam/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Jam atlas verb sits: past the runtime, the script, the `atlas` noun and the `jam` platform. */
const JAM_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const JAM_REPORT_USAGE = "usage: slopweaver atlas jam report [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Print the report, leading with whether there are two surfaces to compare at all.
 *
 * @param asJson whether to print the whole document rather than the summary lines
 * @param report what the surfaces said differently
 *
 * @internal
 */
export function reportJamDisagreement({ asJson, report }: { asJson: boolean; report: JamDisagreementReport }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(report, null, 1) });
    return;
  }
  if (!report.bothSurfacesFilled) {
    logger.out({
      line:
        "jam: only one surface is filled, so there is nothing to compare — " +
        `${String(report.documentedCount)} published operation(s), ${String(report.walkedPageCount)} walked route(s)`,
    });
    return;
  }
  logger.out({
    line:
      `jam surfaces — ${String(report.corroboratedCount)} of ${String(report.documentedCount)} published ` +
      `operation(s) were also seen called; ${String(report.undeclaredApiCalls.length)} call(s) to the ` +
      `documented origin are undeclared, and ${String(report.undocumentedOriginCalls.length)} go to a Jam ` +
      "origin the published description says nothing about",
  });
  for (const call of report.undocumentedOriginCalls) {
    logger.out({
      line: `  undocumented origin: ${call.method} ${call.origin}${call.pathShape}`,
    });
  }
  for (const call of report.undeclaredApiCalls) {
    logger.out({
      line: `  undeclared: ${call.method} ${call.origin}${call.pathShape}`,
    });
  }
  // The all-or-nothing case is printed differently on purpose. With the browser channel naming NO
  // integration at all, "9 published integrations no walked route named" reads as a finding about Jam when
  // it is a limit of what a page walk can see — `browserSurface.ts`'s `jamIntegrationBrowserLimit` carries the
  // measurement, and an earlier cut of this line invented exactly that finding four times over.
  const namedNone = report.integrationsWalkedOnly.length === 0 && report.integrationsPublishedOnly.length > 0;
  if (namedNone) {
    logger.out({
      line:
        `  the browser channel named NO integration, so the ${String(report.integrationsPublishedOnly.length)} ` +
        "published page(s) have nothing to be compared against — read the integration kind's own browser " +
        "coverage cell for why, which is a limit of the walk rather than a fact about this workspace",
    });
  } else if (report.integrationsPublishedOnly.length > 0) {
    logger.out({
      line: `  ${String(report.integrationsPublishedOnly.length)} published integration(s) no walked route named: ${report.integrationsPublishedOnly.join(", ")}`,
    });
  }
  if (report.integrationsWalkedOnly.length > 0) {
    logger.out({
      line: `  ${String(report.integrationsWalkedOnly.length)} integration(s) the application names that Jam publishes no page for: ${report.integrationsWalkedOnly.join(", ")}`,
    });
  }
  if (report.unreachablePages.length > 0) {
    logger.out({ line: `  ${String(report.unreachablePages.length)} route(s) the walk could not open` });
  }
  if (report.unphotographedPages.length > 0) {
    logger.out({ line: `  ${String(report.unphotographedPages.length)} landed route(s) carry no picture` });
  }
}

/** A kind file's entities and gaps — none of either when the kind was never published. */
function publishedRows({ file }: { file: JamAtlasKindFile | null }): {
  readonly entities: readonly JamAtlasEntity[];
  readonly gaps: readonly JamAtlasGap[];
} {
  if (file === null) {
    return { entities: [], gaps: [] };
  }
  return { entities: file.entities, gaps: file.gaps };
}

/**
 * Run the `atlas jam report` verb.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function jamAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: JAM_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: JAM_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((reason) => {
      logger.error({ msg: reason });
    });
    logger.error({ msg: JAM_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const snapshot = readJamAtlas({ paths: jamAtlasPaths({ home: options.value.home }) });
  if (snapshot.isErr()) {
    snapshot.error.forEach((reason) => {
      logger.error({ msg: reason });
    });
    return EXIT_ERROR;
  }
  const pages = publishedRows({ file: snapshot.value.files[JAM_PAGE_KIND] });
  const report = jamDisagreementReport({
    integrations: publishedRows({ file: snapshot.value.files[JAM_INTEGRATION_KIND] }).entities,
    operations: publishedRows({ file: snapshot.value.files[JAM_OPERATION_KIND] }).entities,
    pageGaps: pages.gaps,
    pages: pages.entities,
  });
  reportJamDisagreement({ asJson: options.value.json, report });
  return report.bothSurfacesFilled ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}
