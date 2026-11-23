/**
 * The census assertions and module rendering behind `tools/generatePrismaDataPlatformSurfaces.ts`.
 *
 * Pure helpers split out of the generator so it stays under the file-size cap. This module never imports the
 * generator, which runs `main()` at import.
 */
import {
  PRISMA_DEPRECATED_OPERATIONS,
  PRISMA_SPEC_CENSUS,
  PRISMA_STABILITY_CENSUS,
  PRISMA_UNDECLARED_TAGS,
  PRISMA_UNSERVED_TAGS,
} from "../src/atlas/prismaDataPlatform/generated/specLock.js";
import { prismaDataPlatformKindPrefixes } from "../src/atlas/prismaDataPlatform/kinds.js";
import { PRISMA_HTTP_METHODS } from "../src/atlas/prismaDataPlatform/surfaceNaming.js";
import type { PrismaSurfaceRow } from "../src/atlas/prismaDataPlatform/surfaceRow.js";
import { isRecord } from "../src/lib/parsers.js";
import { refuse } from "./prismaSurfacesOperations.js";

/** Every pinned number, paired with what this run actually found. */
function censusChecks({
  rows,
  spec,
}: {
  rows: readonly PrismaSurfaceRow[];
  spec: Record<string, unknown>;
}): readonly { readonly actual: number; readonly expected: number; readonly what: string }[] {
  const paths = spec["paths"];
  const declaredTags = spec["tags"];
  return [
    { actual: rows.length, expected: PRISMA_SPEC_CENSUS.operations, what: "operations" },
    {
      actual: new Set(rows.map((row) => row.name)).size,
      expected: PRISMA_SPEC_CENSUS.operationIds,
      what: "distinct operationIds",
    },
    { actual: isRecord(paths) ? Object.keys(paths).length : 0, expected: PRISMA_SPEC_CENSUS.paths, what: "paths" },
    {
      actual: Array.isArray(declaredTags) ? declaredTags.length : 0,
      expected: PRISMA_SPEC_CENSUS.tags,
      what: "declared tags",
    },
    {
      actual: new Set(rows.map((row) => row.tag)).size,
      expected: PRISMA_SPEC_CENSUS.tagsCarriedByOperations,
      what: "tags carried by operations",
    },
    {
      actual: rows.filter((row) => row.deprecated).length,
      expected: PRISMA_SPEC_CENSUS.deprecatedOperations,
      what: "deprecated operations",
    },
    {
      actual: rows.filter((row) => row.stability === "experimental").length,
      expected: PRISMA_STABILITY_CENSUS.experimentalOperations,
      what: "experimental operations",
    },
    {
      actual: rows.filter((row) => row.stability === "stable").length,
      expected: PRISMA_STABILITY_CENSUS.stableOperations,
      what: "stable operations",
    },
    {
      actual: rows.filter((row) => row.docsUrl !== null).length,
      expected: PRISMA_STABILITY_CENSUS.documentedOperations,
      what: "documented operations",
    },
    {
      actual: rows.filter((row) => row.docsUrl === null).length,
      expected: PRISMA_STABILITY_CENSUS.undocumentedOperations,
      what: "undocumented operations",
    },
    {
      actual: rows.filter((row) => row.docsUrl !== null && row.stability === "experimental").length,
      expected: PRISMA_STABILITY_CENSUS.documentedExperimentalOperations,
      what: "documented experimental operations",
    },
    {
      actual: rows.filter((row) => row.docsUrl === null && row.stability === "stable").length,
      expected: PRISMA_STABILITY_CENSUS.undocumentedStableOperations,
      what: "undocumented stable operations",
    },
    ...PRISMA_HTTP_METHODS.map((method) => ({
      actual: rows.filter((row) => row.method === method).length,
      expected: PRISMA_SPEC_CENSUS.methodCounts[method],
      what: `${method} operations`,
    })),
  ];
}

/**
 * A comma-joined name list, or the word "none" when there are no names.
 *
 * @param names the names to render
 * @returns the list a refusal message prints
 */
function namesOrNone({ names }: { names: readonly string[] }): string {
  return names.length === 0 ? "none" : names.join(", ");
}

/**
 * Refuse unless every pinned number and every pinned name still holds.
 *
 * @param rows the compiled registry rows
 * @param spec the parsed OpenAPI document
 */
export function assertCensus({
  rows,
  spec,
}: {
  rows: readonly PrismaSurfaceRow[];
  spec: Record<string, unknown>;
}): void {
  const declared = new Set(
    (Array.isArray(spec["tags"]) ? spec["tags"] : [])
      .filter(isRecord)
      .map((tag) => tag["name"])
      .filter((name): name is string => typeof name === "string"),
  );
  const carried = new Set(rows.map((row) => row.tag));
  const undeclared = [...carried].filter((tag) => !declared.has(tag)).toSorted();
  if (undeclared.join(", ") !== [...PRISMA_UNDECLARED_TAGS].toSorted().join(", ")) {
    refuse(
      `which tags are served but undeclared moved: found ${namesOrNone({ names: undeclared })}, pinned ` +
        `${namesOrNone({ names: PRISMA_UNDECLARED_TAGS })} — update PRISMA_UNDECLARED_TAGS in the same commit`,
    );
  }
  const unserved = [...declared].filter((tag) => !carried.has(tag)).toSorted();
  if (unserved.join(", ") !== [...PRISMA_UNSERVED_TAGS].toSorted().join(", ")) {
    refuse(
      `which tags are declared and unserved moved: found ${namesOrNone({ names: unserved })}, pinned ` +
        `${namesOrNone({ names: PRISMA_UNSERVED_TAGS })} — a declared tag with no operations is a surface` +
        " Prisma has promised and not shipped; update PRISMA_UNSERVED_TAGS and say so in the same commit",
    );
  }
  const deprecated = rows.filter((row) => row.deprecated).map((row) => row.name);
  const moved = [
    ...deprecated.filter((name) => !PRISMA_DEPRECATED_OPERATIONS.includes(name)).map((n) => `  ${n} is now deprecated`),
    ...PRISMA_DEPRECATED_OPERATIONS.filter((name) => !deprecated.includes(name)).map(
      (name) => `  ${name} is no longer deprecated`,
    ),
  ];
  if (moved.length > 0) {
    refuse(
      `the deprecation set moved:\n${moved.join("\n")}\nupdate PRISMA_DEPRECATED_OPERATIONS in the same` +
        " commit, and say in the pull request which noun Prisma has renamed or revived",
    );
  }
  const usedPrefixes = new Set<string>();
  prismaDataPlatformKindPrefixes().forEach((prefix) => {
    if (rows.some((row) => row.path === prefix || row.path.startsWith(`${prefix}/`))) {
      usedPrefixes.add(prefix);
    }
  });
  const stale = prismaDataPlatformKindPrefixes().filter((prefix) => !usedPrefixes.has(prefix));
  if (stale.length > 0) {
    refuse(
      `${stale.join(", ")} in kinds.ts no longer prefixes any declared path — Prisma has removed a family;` +
        " drop the row and say which surface went in the same commit",
    );
  }
  const broken = censusChecks({ rows, spec }).filter((check) => check.actual !== check.expected);
  if (broken.length > 0) {
    refuse(
      `the census moved:\n${broken
        .map((check) => `  ${check.what}: pinned ${String(check.expected)}, found ${String(check.actual)}`)
        .join("\n")}\nreview the change, then update generated/specLock.ts in the same commit`,
    );
  }
}

/**
 * The module text, one row per line so a diff reads as a list of operations.
 *
 * @param rows the compiled registry rows
 * @returns the full text of the generated module
 */
export function moduleText({ rows }: { rows: readonly PrismaSurfaceRow[] }): string {
  const counts = (["entity", "shape-index", "probe-only", "excluded"] as const)
    .map((disposition) => `${String(rows.filter((row) => row.disposition === disposition).length)} ${disposition}`)
    .join(", ");
  const kinds = new Set(rows.filter((row) => row.disposition !== "excluded").map((row) => row.kind)).size;
  const documented = rows.filter((row) => row.docsUrl !== null).length;
  return `${[
    "/**",
    " * GENERATED — do not hand-edit. Regenerate with",
    " * `yarn tsx tools/generatePrismaDataPlatformSurfaces.ts` and review the diff. Built from the OpenAPI",
    " * document pinned in `specLock.ts` and the docs sitemap that mapped each page to an operation.",
    " *",
    ` * ${String(rows.length)} rows: ${counts}. ${String(kinds)} kinds carry a callable operation, and`,
    ` * ${String(documented)} of the ${String(rows.length)} operations have a documentation page.`,
    " */",
    'import type { PrismaSurfaceRow } from "../surfaceRow.js";',
    "",
    "/** Every Prisma Data Platform management-API operation, whatever this atlas does with each, sorted by name. */",
    "export const PRISMA_DATA_PLATFORM_SURFACES: readonly PrismaSurfaceRow[] = [",
    ...rows.toSorted((left, right) => left.name.localeCompare(right.name)).map((row) => `  ${rowText({ row })},`),
    "];",
  ].join("\n")}\n`;
}

/** One row, as source. */
function rowText({ row }: { row: PrismaSurfaceRow }): string {
  const fields = [
    `alsoFeeds: ${JSON.stringify(row.alsoFeeds)}`,
    `authMethods: ${JSON.stringify(row.authMethods)}`,
    `deprecated: ${String(row.deprecated)}`,
    `disposition: ${JSON.stringify(row.disposition)}`,
    `dispositionBecause: ${JSON.stringify(row.dispositionBecause)}`,
    `docsUrl: ${JSON.stringify(row.docsUrl)}`,
    `exclusionReason: ${JSON.stringify(row.exclusionReason)}`,
    `kind: ${JSON.stringify(row.kind)}`,
    `method: ${JSON.stringify(row.method)}`,
    `name: ${JSON.stringify(row.name)}`,
    `paging: ${JSON.stringify(row.paging)}`,
    `path: ${JSON.stringify(row.path)}`,
    `probeEvidence: ${JSON.stringify(row.probeEvidence)}`,
    `responseFieldCount: ${String(row.responseFieldCount)}`,
    `scopes: ${JSON.stringify(row.scopes)}`,
    `stability: ${JSON.stringify(row.stability)}`,
    `summary: ${JSON.stringify(row.summary)}`,
    `tag: ${JSON.stringify(row.tag)}`,
  ];
  return `{ ${fields.join(", ")} }`;
}
