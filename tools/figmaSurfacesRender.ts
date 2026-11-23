/**
 * The pure rendering and census arithmetic `tools/generateFigmaSurfaces.ts` runs once it has the rows: the
 * generated module's text, one row as source, and every number the census pins. Split out so the generator
 * stays under the file-size cap; nothing here refuses, reaches the network or touches the filesystem.
 */
import { FIGMA_AUTH_METHOD_CENSUS, FIGMA_SPEC_CENSUS } from "../src/atlas/figma/generated/specLock.js";
import { FIGMA_AUTH_METHODS, FIGMA_HTTP_METHODS } from "../src/atlas/figma/surfaceNaming.js";
import type { FigmaSurfaceRow } from "../src/atlas/figma/surfaceRow.js";
import { isRecord } from "../src/lib/parsers.js";

/**
 * Every number the census pins, computed from what was actually extracted.
 *
 * @returns one expected-against-actual pair per pinned number
 */
export function censusChecks({
  rows,
  spec,
}: {
  rows: readonly FigmaSurfaceRow[];
  spec: Record<string, unknown>;
}): readonly {
  readonly actual: number;
  readonly expected: number;
  readonly what: string;
}[] {
  const paths = isRecord(spec["paths"]) ? Object.keys(spec["paths"]).length : 0;
  const components = spec["components"];
  const schemas =
    isRecord(components) && isRecord(components["schemas"]) ? Object.keys(components["schemas"]).length : 0;
  const tags = Array.isArray(spec["tags"]) ? spec["tags"].length : 0;
  return [
    { actual: rows.length, expected: FIGMA_SPEC_CENSUS.operations, what: "operations" },
    {
      actual: new Set(rows.map((row) => row.name)).size,
      expected: FIGMA_SPEC_CENSUS.operationIds,
      what: "operationIds",
    },
    { actual: paths, expected: FIGMA_SPEC_CENSUS.paths, what: "paths" },
    { actual: schemas, expected: FIGMA_SPEC_CENSUS.schemas, what: "component schemas" },
    {
      actual: new Set(rows.flatMap((row) => row.scopes)).size,
      expected: FIGMA_SPEC_CENSUS.scopes,
      what: "distinct scopes",
    },
    { actual: tags, expected: FIGMA_SPEC_CENSUS.tags, what: "declared tags" },
    {
      actual: new Set(rows.map((row) => row.tag)).size,
      expected: FIGMA_SPEC_CENSUS.tagsWithOperations,
      what: "tags carrying at least one operation",
    },
    {
      actual: rows.filter((row) => row.deprecated).length,
      expected: FIGMA_SPEC_CENSUS.deprecatedOperations,
      what: "deprecated operations",
    },
    ...FIGMA_HTTP_METHODS.map((method) => ({
      actual: rows.filter((row) => row.method === method).length,
      expected: FIGMA_SPEC_CENSUS.methodCounts[method],
      what: `${method} operations`,
    })),
    ...FIGMA_AUTH_METHODS.map((auth) => ({
      actual: rows.filter((row) => row.authMethods.includes(auth)).length,
      expected: FIGMA_AUTH_METHOD_CENSUS[auth],
      what: `operations accepting ${auth}`,
    })),
  ];
}

/**
 * The module text, one row per line so a diff reads as a list of operations.
 *
 * @returns the full source of the generated registry module
 */
export function moduleText({ rows }: { rows: readonly FigmaSurfaceRow[] }): string {
  const counts = (["entity", "shape-index", "probe-only", "excluded"] as const)
    .map((disposition) => `${String(rows.filter((row) => row.disposition === disposition).length)} ${disposition}`)
    .join(", ");
  const kinds = new Set(rows.filter((row) => row.disposition !== "excluded").map((row) => row.kind)).size;
  return `${[
    "/**",
    " * GENERATED — do not hand-edit. Regenerate with `yarn tsx tools/generateFigmaSurfaces.ts` and review",
    " * the diff. Built from the OpenAPI document pinned in `specLock.ts`.",
    " *",
    ` * ${String(rows.length)} rows: ${counts}. ${String(kinds)} kinds carry a callable operation.`,
    " */",
    'import type { FigmaSurfaceRow } from "../surfaceRow.js";',
    "",
    "/** Every Figma REST operation this atlas knows of, whatever it does with each, sorted by name. */",
    "export const FIGMA_SURFACES: readonly FigmaSurfaceRow[] = [",
    ...rows.toSorted((left, right) => left.name.localeCompare(right.name)).map((row) => `  ${rowText({ row })},`),
    "];",
  ].join("\n")}\n`;
}

/** One row, as source. */
function rowText({ row }: { row: FigmaSurfaceRow }): string {
  const fields = [
    `alsoFeeds: ${JSON.stringify(row.alsoFeeds)}`,
    `authMethods: ${JSON.stringify(row.authMethods)}`,
    `deprecated: ${String(row.deprecated)}`,
    `disposition: ${JSON.stringify(row.disposition)}`,
    `dispositionBecause: ${JSON.stringify(row.dispositionBecause)}`,
    `exclusionReason: ${JSON.stringify(row.exclusionReason)}`,
    `kind: ${JSON.stringify(row.kind)}`,
    `method: ${JSON.stringify(row.method)}`,
    `name: ${JSON.stringify(row.name)}`,
    `paging: ${JSON.stringify(row.paging)}`,
    `path: ${JSON.stringify(row.path)}`,
    `scopes: ${JSON.stringify(row.scopes)}`,
    `summary: ${JSON.stringify(row.summary)}`,
    `tag: ${JSON.stringify(row.tag)}`,
  ];
  return `{ ${fields.join(", ")} }`;
}
