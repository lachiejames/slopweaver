/**
 * `slopweaver atlas hex report [--json] [--home <dir>]` — print where Hex's surfaces disagree.
 *
 * No network call and no browser: it reads the published generation and the two committed measurements and
 * prints what is already in them. It RESOLVES NOTHING, which is the owner's ruling rather than a limitation
 * — which surface wins when two disagree is a decision reserved for the owner until they can see real instances, so
 * this verb's whole job is to put those instances in front of them.
 *
 * Two of its four classes need no browser session at all, which is what makes this verb worth running on a
 * fresh install: a mounted noun the published document declares nothing under, and a GraphQL operation the
 * shipped client can send that the document knows nothing about.
 */
import type { HexAtlasKindFile } from "../../../atlas/hex/model.js";
import { type HexReport, reportHexDisagreements } from "../../../atlas/hex/report.js";
import { hexAtlasPaths, readHexAtlas } from "../../../atlas/hex/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Hex atlas verb sits: past the runtime, the script, the `atlas` noun and the `hex` platform. */
const HEX_VERB_INDEX = 4;

/** How many disagreements of one class are printed before the rest are counted. */
const PRINTED_PER_KIND = 20;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const HEX_REPORT_USAGE = "usage: slopweaver atlas hex report [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * The path keys the published document declares, read off the STORE rather than fetched again.
 *
 * The `method` rows the sync published carry one provider id per operation, and the api-channel ones whose
 * evidence is the document are exactly its declared paths. Recomputing them from a fresh fetch would make
 * this verb reach the network to describe a generation that is already on disk, and would report a
 * disagreement between a document nobody has synced and a store that has been.
 *
 * @param providerIds every `method` row's provider id
 * @returns the declared path keys, deduplicated
 */
export function declaredPathsFrom({ providerIds }: { providerIds: readonly string[] }): readonly string[] {
  return [
    ...new Set(
      providerIds
        .filter(
          (id) =>
            id.startsWith("GET /") ||
            id.startsWith("POST /") ||
            id.startsWith("PUT /") ||
            id.startsWith("PATCH /") ||
            id.startsWith("DELETE /"),
        )
        .map((id) => id.slice(id.indexOf(" ") + 1)),
    ),
  ];
}

/** The four classes, in the order a reader acts on them. */
const PRINT_ORDER = ["field-divergence", "browser-only", "undeclared-noun", "undeclared-graphql"] as const;

/**
 * The lines for one class of disagreement, or none when it found nothing.
 *
 * @param kind the class to render
 * @param report what the pure pass found
 * @returns the lines, headed by the count
 */
function renderKind({
  kind,
  report,
}: {
  kind: HexReport["disagreements"][number]["kind"];
  report: HexReport;
}): readonly string[] {
  const found = report.disagreements.filter((row) => row.kind === kind);
  if (found.length === 0) {
    return [];
  }
  const shown = found.slice(0, PRINTED_PER_KIND).map((row) => {
    const fields = row.fields.length === 0 ? "" : ` — fields: ${row.fields.join(", ")}`;
    return `    ${row.providerId}${fields}`;
  });
  const rest =
    found.length > PRINTED_PER_KIND
      ? [`    … and ${String(found.length - PRINTED_PER_KIND)} more; --json prints every one`]
      : [];
  return [`  ${kind}: ${String(found.length)}`, ...shown, ...rest];
}

/**
 * What a reader has to know about the findings themselves — what was excluded, and what could not be measured.
 *
 * @param report what the pure pass found
 * @returns the caveat lines, in print order
 */
function renderCaveats({ report }: { report: HexReport }): readonly string[] {
  const lines: string[] = [];
  if (report.withheldFromComparison > 0) {
    lines.push(
      `  ${String(report.withheldFromComparison)} row(s) excluded from the field comparison: their body is ` +
        "withheld, so an empty field list is policy rather than a measurement",
    );
  }
  if (report.unmeasurableBecause !== null) {
    lines.push(`  the browser half is unmeasurable: ${report.unmeasurableBecause}`);
  }
  if (report.disagreements.length === 0) {
    lines.push("  every surface agrees on everything any of them knows");
  }
  return lines;
}

/**
 * The lines the report prints, headline first.
 *
 * @param report what the pure pass found
 * @returns the lines, in print order
 *
 * @internal
 */
export function renderHexReport({ report }: { report: HexReport }): readonly string[] {
  return [
    `hex surfaces — ${String(report.specKnown)} operation(s) known to the anonymous evidence, ` +
      `${String(report.browserKnown)} to the app`,
    ...PRINT_ORDER.flatMap((kind) => renderKind({ kind, report })),
    ...renderCaveats({ report }),
  ];
}

/** The provider ids of every published method — none when the method kind was never published. */
function publishedMethodIds({ methods }: { methods: HexAtlasKindFile | null }): readonly string[] {
  if (methods === null) {
    return [];
  }
  return methods.entities.map((entity) => entity.providerId);
}

/**
 * Print where the surfaces disagree.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function hexAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: HEX_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HEX_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: HEX_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const snapshot = readHexAtlas({ paths: hexAtlasPaths({ home: options.value.home }) });
  if (snapshot.isErr()) {
    snapshot.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const report = reportHexDisagreements({
    declaredPaths: declaredPathsFrom({
      providerIds: publishedMethodIds({ methods: snapshot.value.files.method }),
    }),
    methods: snapshot.value.files.method,
  });
  if (options.value.json) {
    logger.out({ line: JSON.stringify(report, null, 1) });
    return EXIT_OK;
  }
  for (const line of renderHexReport({ report })) {
    logger.out({ line });
  }
  return EXIT_OK;
}
