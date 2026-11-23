/**
 * The pure half of `slopweaver datadog catalogue` — flag parsing and every rendered line.
 *
 * Split from {@link ./catalogueRun} for the reason every shell here is split: a line a person reads is a
 * value a test can assert, so the effectful half is a plain resolve → build → write → print sequence with
 * nothing in it worth a test of its own.
 */

import type { CensusReport } from "../../../datadog/census/build.js";
import { CENSUS_PRODUCTS, type CensusProduct, censusProductNamed } from "../../../datadog/census/product.js";
import type { CensusRow } from "../../../datadog/census/row.js";
import type { Catalogue } from "../../../datadog/detective/catalogue.js";
import { catalogueEnvs, catalogueServices } from "../../../datadog/detective/catalogue.js";
import { facetValues } from "../../../datadog/detective/facets.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { type DatadogArgsError, DatadogArgsErrors, datadogArgsErrorLines } from "./errors.js";

/** What a `catalogue build` invocation asked for. */
export interface CatalogueBuildArgs {
  readonly from: string;
  readonly to: string;
  readonly products: readonly CensusProduct[];
  readonly home: string | undefined;
  readonly json: boolean;
}

/** What a `catalogue show` invocation asked for. */
export interface CatalogueShowArgs {
  readonly service: string | undefined;
  readonly product: CensusProduct | undefined;
  /** A fragment matched against a row's label, so `show --query session` reads like a search. */
  readonly query: string | undefined;
  readonly limit: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * How many rows `show` prints when the caller names no limit.
 *
 * @internal
 */
export const DEFAULT_SHOW_LIMIT = 20;

/**
 * Read a whole-number flag, refusing rather than coercing.
 *
 * @param values the parsed flags
 * @param name which flag
 * @param fallback what it is when absent
 * @returns the number, or the reason it was refused
 */
function positiveInt({
  values,
  name,
  fallback,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
  fallback: number;
}): Result<number, DatadogArgsError> {
  const raw = values[name];
  if (raw === undefined) {
    return ok(fallback);
  }
  // Read as a string before it is a number, so the refusal can quote what the caller actually typed. A flag
  // given with no value parses as `true`, which is a real caller mistake and has to read as one.
  const written = typeof raw === "string" ? raw : "(no value)";
  const parsed = Number(written);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return err(DatadogArgsErrors.notAWholeNumber({ flag: `--${name}`, got: written }));
  }
  return ok(parsed);
}

/**
 * Read a comma-separated product list, refusing an unknown name rather than ignoring it.
 *
 * @param raw the flag's value, or nothing
 * @param fallback what the list is when the flag is absent
 * @returns the products, or the reason the list was refused
 */
export function parseProducts({
  raw,
  fallback,
}: {
  raw: unknown;
  fallback: readonly CensusProduct[];
}): Result<readonly CensusProduct[]> {
  if (typeof raw !== "string" || raw.length === 0) {
    return ok(fallback);
  }
  const asked = raw.split(",").map((one) => one.trim());
  const products: CensusProduct[] = [];
  const refusals: string[] = [];
  for (const name of asked) {
    const known = censusProductNamed({ raw: name });
    if (known === null) {
      refusals.push(`--product "${name}" is not one of ${CENSUS_PRODUCTS.join(", ")}`);
      continue;
    }
    products.push(known);
  }
  return refusals.length > 0 ? err(refusals) : ok(products);
}

/**
 * Parse `datadog catalogue build`.
 *
 * The default window is SEVEN days rather than one, because the census is what a detective reads before it
 * knows what it is looking for: a pattern that fires twice a week is exactly the kind a one-day window calls
 * absent. Fifteen days is the index's own retention ceiling, so seven leaves room to widen deliberately.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseCatalogueBuildArgs({ rest }: { rest: readonly string[] }): Result<CatalogueBuildArgs> {
  const flags = parseFlags({
    args: rest,
    spec: { boolean: ["json"], string: ["from", "to", "product", "home"] },
  });
  if (flags.isErr()) {
    return err(flags.error);
  }
  const { values } = flags.value;
  const products = parseProducts({ fallback: CENSUS_PRODUCTS, raw: values["product"] });
  if (products.isErr()) {
    return err(products.error);
  }
  return ok({
    from: typeof values["from"] === "string" ? values["from"] : "7d",
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    products: products.value,
    to: typeof values["to"] === "string" ? values["to"] : "now",
  });
}

/**
 * Parse `datadog catalogue show`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseCatalogueShowArgs({ rest }: { rest: readonly string[] }): Result<CatalogueShowArgs> {
  const flags = parseFlags({
    args: rest,
    spec: { boolean: ["json"], string: ["service", "product", "query", "limit", "home"] },
  });
  if (flags.isErr()) {
    return err(flags.error);
  }
  const { values } = flags.value;
  const products = parseProducts({ fallback: [], raw: values["product"] });
  const limit = positiveInt({ fallback: DEFAULT_SHOW_LIMIT, name: "limit", values });
  if (products.isErr() || limit.isErr()) {
    return err([
      ...(products.isErr() ? products.error : []),
      ...(limit.isErr() ? datadogArgsErrorLines({ error: limit.error }) : []),
    ]);
  }
  return ok({
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    limit: limit.value,
    product: products.value[0],
    query: typeof values["query"] === "string" ? values["query"] : undefined,
    service: typeof values["service"] === "string" ? values["service"] : undefined,
  });
}

/**
 * The report a build prints.
 *
 * `notMeasured` is printed IN FULL and last, never truncated, because it is the half of the report a reader
 * will otherwise assume is empty — and a census whose gaps are invisible is the one that produces a
 * confident wrong answer later.
 *
 * @param report what the pass produced
 * @param manifestPath where the manifest was written
 * @returns the lines
 */
export function buildLines({
  report,
  manifestPath,
}: {
  report: CensusReport;
  manifestPath: string;
}): readonly string[] {
  const { manifest } = report.catalogue;
  const map = manifest.map;
  return [
    `datadog census built — ${String(manifest.rows)} row(s) across ${String(manifest.products.length)} product(s)`,
    `  site:      ${manifest.site}`,
    `  window:    ${manifest.window.fromIso} .. ${manifest.window.toIso}`,
    `  retention: ${manifest.retentionDays === null ? "not reported by any index" : `${String(manifest.retentionDays)} day(s)`}`,
    ...manifest.products.map(
      (tally) =>
        `  ${tally.product.padEnd(13)} ${String(tally.rows).padStart(6)} row(s), ${String(tally.exemplified)} exemplified`,
    ),
    `  services:  ${String(new Set(manifest.services.map((one) => one.service)).size)} distinct, across every product`,
    `  map:       ${String(map.entities.length)} entit(ies), ${String(map.monitors.length)} monitor(s), ${String(map.dashboards.length)} dashboard(s), ${String(map.pipelines.length)} pipeline(s), ${String(map.indexes.length)} index(es), ${String(map.rumApplications.length)} RUM app(s), ${String(map.metricNamespaces.length)} metric namespace(s), ${String(map.edges.length)} span edge(s)`,
    `  written:   ${manifestPath}`,
    ...(manifest.notMeasured.length === 0
      ? ["  not measured: nothing — every leg came back"]
      : ["  not measured:", ...manifest.notMeasured.map((line) => `    ${line}`)]),
  ];
}

/**
 * The rows `show` selected, after the caller's filters.
 *
 * @param catalogue the built census
 * @param args what the caller filtered by
 * @returns the matching rows, biggest first, capped at the limit
 */
export function selectRows({
  catalogue,
  args,
}: {
  catalogue: Catalogue;
  args: CatalogueShowArgs;
}): readonly CensusRow[] {
  const wanted = args.query === undefined ? null : args.query.toLowerCase();
  return catalogue.rows
    .filter((row) => args.service === undefined || row.service === args.service)
    .filter((row) => args.product === undefined || row.product === args.product)
    .filter((row) => wanted === null || row.label.toLowerCase().includes(wanted))
    .slice(0, args.limit);
}

/**
 * How one row's count reads, including the two cases where it is not a count of the window.
 *
 * @param row the row to describe
 * @returns the phrase, e.g. `861,782 events` or `no event count — a metric is a name, not an occurrence`
 */
export function countLine({ row }: { row: CensusRow }): string {
  if (row.count === null) {
    return "no event count — a metric is a name this organisation can query, not an occurrence";
  }
  if (row.countFrom === "page") {
    return `${row.count.toLocaleString("en-AU")} event(s) seen on the sampled pages — a floor, not the window's total`;
  }
  return `${row.count.toLocaleString("en-AU")} event(s) in the window`;
}

/**
 * The report `show` prints — the census's own summary, then the selected rows.
 *
 * @param catalogue the built census
 * @param args what the caller filtered by
 * @returns the lines
 */
export function showLines({ catalogue, args }: { catalogue: Catalogue; args: CatalogueShowArgs }): readonly string[] {
  const selected = selectRows({ args, catalogue });
  const services = catalogueServices({ catalogue });
  return [
    `datadog census — built ${catalogue.manifest.builtAtIso}, ${String(catalogue.rows.length)} row(s) over ${String(services.length)} service(s)`,
    `  environments: ${catalogueEnvs({ catalogue }).join(", ")}`,
    "",
    ...selected.flatMap((row) => [
      `${row.key}`,
      `  ${countLine({ row })}`,
      ...(row.template === null ? [] : [`  template: ${row.template}`]),
      `  paths:    ${String(row.paths.length)} attribute path(s) from ${String(row.exemplars)} exemplar(s)`,
      ...(row.members.length === 0
        ? []
        : [
            `  under it: ${row.members
              .slice(0, 5)
              .map((member) => member.name)
              .join(", ")}${row.members.length > 5 ? ` and ${String(row.members.length - 5)} more` : ""}`,
          ]),
      ...row.facets
        .filter((facet) => facet.values !== null && facet.values.length > 0)
        .map((facet) => `  ${facet.path}: ${facetValues({ facet }).join(", ")}`),
      `  query:    ${row.query}`,
      "",
    ]),
    `${String(selected.length)} of ${String(catalogue.rows.length)} row(s) shown`,
    ...(catalogue.manifest.notMeasured.length === 0
      ? []
      : ["not measured:", ...catalogue.manifest.notMeasured.map((line) => `  ${line}`)]),
  ];
}

/** Which half of `datadog catalogue` an invocation asked for. *
 * @internal
 */
export type CatalogueMode = "build" | "show";

/** A parsed invocation of either half, tagged so a caller knows which it got. */
export type CatalogueArgs =
  | { readonly mode: "build"; readonly build: CatalogueBuildArgs }
  | { readonly mode: "show"; readonly show: CatalogueShowArgs };

/**
 * Parse `datadog catalogue <build|show>` — the ONE entry point the verb and the help ratchet both use.
 *
 * It exists because `build` and `show` take disjoint flag sets, and a verb whose flags are only reachable
 * through two separate functions is a verb the help-and-flags ratchet cannot check: the gate probes one
 * parser per verb address, so two parsers means either an opt-out or a dispatcher. An opt-out is how a
 * shipped flag stays invisible, which is the exact failure that gate exists to catch — so this is the
 * dispatcher, and the sub-verb is part of what it parses rather than something a caller strips first.
 *
 * @param rest the verb's own argv tail, INCLUDING the sub-verb
 * @returns what it asked for, or every reason it was refused
 */
export function parseCatalogueArgs({ rest }: { rest: readonly string[] }): Result<CatalogueArgs, DatadogArgsError> {
  const [mode, ...tail] = rest;
  if (mode === "build") {
    return parseCatalogueBuildArgs({ rest: tail })
      .map((build) => ({ build, mode: "build" as const }))
      .mapErr((reasons) => DatadogArgsErrors.optionsRefused({ reasons }));
  }
  if (mode === "show") {
    return parseCatalogueShowArgs({ rest: tail })
      .map((show) => ({ mode: "show" as const, show }))
      .mapErr((reasons) => DatadogArgsErrors.optionsRefused({ reasons }));
  }
  return err(
    mode === undefined
      ? DatadogArgsErrors.catalogueModeMissing()
      : DatadogArgsErrors.catalogueModeUnknown({ got: mode }),
  );
}

/**
 * Every flag `datadog catalogue` accepts, across both halves, as the parsers themselves read them.
 *
 * Exported rather than inlined so the help/flag ratchet can compare the advertised set against the accepted
 * one instead of taking the usage string's word for it — the check that caught a shipped, documented flag
 * being silently unparsed elsewhere in this CLI. The union of the two halves is the right set here because a
 * reader of `catalogue --help` sees both lines: a flag missing from either half is a flag that is documented
 * and unreachable, which is exactly the failure the ratchet names.
 */
export const CATALOGUE_FLAG_NAMES: readonly string[] = [
  "--from",
  "--to",
  "--product",
  "--home",
  "--json",
  "--service",
  "--query",
  "--limit",
];
