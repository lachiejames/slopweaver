/**
 * `slopweaver atlas knock report [--json] [--home <dir>]` — where Knock's two surfaces disagree.
 *
 * `docs/atlas-intent/04-corroboration.md` makes corroboration between the API and the browser an OUTPUT of an atlas
 * rather than a build-time check that gets discarded, and this verb is that output. It reads the published
 * generation rather than recomputing anything, so what it prints is exactly what the atlas holds.
 *
 * ## Three disagreements, and they are different kinds of thing
 *
 * - **A page no API backs.** The dashboard declares a route whose subject no operation this atlas would
 *   call ever reads. The most consequential findings on this platform are here.
 * - **A call no document declares.** The dashboard's own client asked for something neither published
 *   OpenAPI document declares — the `dapi.clerk.com` shape, on Knock. Only a walk produces these, so the
 *   count is zero until one has run, and this verb says which of those two states it is in.
 * - **An operation whose identifiers no API produces**, or that needs the other credential. Not a
 *   browser-versus-API disagreement at all but an API-versus-ITSELF one, reported here because a reader
 *   asking "what can this platform not tell me" wants all three in one place.
 *
 * ## No URL and no account slug is ever printed
 *
 * Every row is named by its ROUTE PATTERN or its path TEMPLATE, both of which this atlas declared and
 * neither of which carries an identifier. The generation holds the real addresses; this verb does not print
 * them.
 */
import { openKnockGaps } from "../../../atlas/knock/gaps.js";
import type { KnockGap, KnockKindFile } from "../../../atlas/knock/model.js";
import { knockAtlasPaths, readKnockAtlas } from "../../../atlas/knock/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Knock atlas verb sits: past the runtime, the script, the `atlas` noun and the `knock` platform. */
const KNOCK_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const KNOCK_REPORT_USAGE = "usage: slopweaver atlas knock report [--json] [--home <dir>]";

/** What the report found. */
interface KnockReport {
  /** Route patterns the dashboard declares and no callable operation backs. */
  readonly pagesWithNoApi: readonly string[];
  /** Path templates whose identifiers neither published document produces. */
  readonly unreachableOperations: readonly string[];
  /** Path templates reachable only by holding BOTH credentials. */
  readonly crossApiOperations: readonly string[];
  /** Whether a walk has ever filled the browser channel; the call census is meaningless until it has. */
  readonly walked: boolean;
  /** Route patterns a walk declared and could not hold. */
  readonly pagesNotHeld: readonly string[];
}

/** Parse the flag tail this verb accepts. */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** A kind file's open gaps — none when the kind was never published. */
function openGapsOf({ file }: { file: KnockKindFile | null }): readonly KnockGap[] {
  if (file === null) {
    return [];
  }
  return openKnockGaps({ gaps: file.gaps });
}

/** Whether a walk ever filled a route's browser channel — never, when no route file was published. */
function everWalked({ routes }: { routes: KnockKindFile | null }): boolean {
  if (routes === null) {
    return false;
  }
  return routes.entities.some((entity) => entity.channels.browser !== null);
}

/** Read the published generation and reduce it to the three disagreements. */
function buildReport({ home }: { home: string }): Result<KnockReport> {
  const snapshot = readKnockAtlas({ paths: knockAtlasPaths({ home }) });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const routes = snapshot.value.files["dashboard-route"];
  const methods = snapshot.value.files["method"];
  const routeGaps = openGapsOf({ file: routes });
  const methodGaps = openGapsOf({ file: methods });
  return ok({
    crossApiOperations: methodGaps
      .filter((gap) => gap.condition === "cross-api-identifier-dependency")
      .map((gap) => gap.scope)
      .toSorted(),
    pagesNotHeld: routeGaps
      .filter((gap) => gap.condition === "page-unreachable")
      .map((gap) => gap.scope)
      .toSorted(),
    pagesWithNoApi: routeGaps
      .filter((gap) => gap.condition === "dashboard-page-has-no-api")
      .map((gap) => gap.scope)
      .toSorted(),
    unreachableOperations: methodGaps
      .filter((gap) => gap.condition === "identifier-produced-by-neither-api")
      .map((gap) => gap.scope)
      .toSorted(),
    walked: everWalked({ routes }),
  });
}

/** Print the report, as JSON or as prose. */
function print({ asJson, report }: { asJson: boolean; report: KnockReport }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(report, null, 1) });
    return;
  }
  logger.out({
    line:
      `knock surface disagreements — ${String(report.pagesWithNoApi.length)} dashboard page(s) no API ` +
      `backs, ${String(report.unreachableOperations.length)} operation(s) whose identifiers neither API ` +
      `produces, ${String(report.crossApiOperations.length)} that need BOTH credentials`,
  });
  logger.out({
    line: report.walked
      ? `  browser channel filled; ${String(report.pagesNotHeld.length)} declared page(s) not held`
      : "  browser channel EMPTY — run `slopweaver atlas knock walk` to fill it; until then no call this" +
        " dashboard makes has been observed at all",
  });
  for (const route of report.pagesWithNoApi) {
    logger.out({ line: `  no-api    ${route}` });
  }
  for (const path of report.unreachableOperations) {
    logger.out({ line: `  no-ident  ${path}` });
  }
  for (const path of report.crossApiOperations) {
    logger.out({ line: `  two-creds ${path}` });
  }
}

/**
 * Run the Knock disagreement report.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function knockAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: KNOCK_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: KNOCK_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: KNOCK_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const report = buildReport({ home: options.value.home });
  if (report.isErr()) {
    report.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  print({ asJson: options.value.json, report: report.value });
  return EXIT_OK;
}
