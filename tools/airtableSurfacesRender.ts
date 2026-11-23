/**
 * Render the Airtable registry as the committed `generated/surfaces.ts` module text.
 *
 * Split out of `tools/generateAirtableSurfaces.ts` so the generator stays under the file-size cap; the pure
 * rendering lives here and the fetch, extraction and census checks stay there.
 */
import type { AirtableSurfaceRow } from "../src/atlas/airtable/surfaceRow.js";

/**
 * The module text, one row per line so a diff reads as a list of operations.
 *
 * @returns the whole generated module, ending in a newline
 */
export function moduleText({ rows }: { rows: readonly AirtableSurfaceRow[] }): string {
  const counts = (["entity", "shape-index", "probe-only", "excluded"] as const)
    .map((disposition) => `${String(rows.filter((row) => row.disposition === disposition).length)} ${disposition}`)
    .join(", ");
  const kinds = new Set(rows.filter((row) => row.disposition !== "excluded").map((row) => row.kind)).size;
  return `${[
    "/**",
    " * GENERATED — do not hand-edit. Regenerate with `yarn tsx tools/generateAirtableSurfaces.ts` and review",
    " * the diff. Built from the OpenAPI document pinned in `specLock.ts`.",
    " *",
    ` * ${String(rows.length)} rows: ${counts}. ${String(kinds)} kinds carry a callable operation.`,
    " */",
    'import type { AirtableSurfaceRow } from "../surfaceRow.js";',
    "",
    "/** Every Airtable Web API operation this atlas knows of, whatever it does with each, sorted by name. */",
    "export const AIRTABLE_SURFACES: readonly AirtableSurfaceRow[] = [",
    ...rows.toSorted((left, right) => left.name.localeCompare(right.name)).map((row) => `  ${rowText({ row })},`),
    "];",
  ].join("\n")}\n`;
}

/** One row, as source. */
function rowText({ row }: { row: AirtableSurfaceRow }): string {
  const fields = [
    `alsoFeeds: ${JSON.stringify(row.alsoFeeds)}`,
    `authMethods: ${JSON.stringify(row.authMethods)}`,
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
    `volumeJudgedPerScope: ${String(row.volumeJudgedPerScope)}`,
  ];
  return `{ ${fields.join(", ")} }`;
}
