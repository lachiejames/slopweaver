/**
 * Emit `src/atlas/datadog/generated/surfaces.ts` from the artifacts pinned in `sdkLock.ts`.
 *
 * ```bash
 * yarn tsx tools/generateDatadogSurfaces.ts --spec-dir <dir>   # write the registry
 * yarn tsx tools/generateDatadogSurfaces.ts --verify           # check the SDK pin and census only
 * yarn tsx tools/generateDatadogSurfaces.ts --verify --spec-dir <dir>  # plus the spec pin and parity
 * ```
 *
 * `<dir>` holds `v1.yaml` and `v2.yaml` fetched from the immutable tag URLs in `sdkLock.ts`. They are
 * needed only to WRITE, because the one thing they contribute — Datadog's own `deprecated` flag — is baked
 * into the committed rows.
 *
 * REFUSES when a digest, a module count, the operation census, the unstable count or the spec/SDK parity
 * moves. The generated table is the read-only boundary, and a table regenerated from whatever `yarn up`
 * installed this morning is a table nobody reviewed.
 *
 * ## How an operation is extracted, and why it is total
 *
 * Every operation in the compiled client emits the same three things in the same order: a
 * `const localVarPath = "..."`, a `.getServer("<spec>.<Class>Api.<operation>")` and a
 * `.makeRequestContext(localVarPath, HttpMethod.<M>)`. The `getServer` site is the anchor because it is the
 * one place an operation names itself; the path is the LAST `localVarPath` before that site, and the query
 * parameters and unstable guard are what sits between it and the next site. Nothing is inferred and nothing
 * is skipped: the extraction asserts that the number of anchors it matched equals the number of `getServer`
 * call sites in the file, so a regex that quietly loses an operation fails the run.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import {
  DATADOG_OBSERVATIONAL_POSTS,
  datadogExclusionFor,
  datadogKindExclusionFor,
  datadogProbeOnlyFor,
} from "../src/atlas/datadog/exclusions.js";
import { DATADOG_SPEC_PARITY, DATADOG_SPEC_PINS } from "../src/atlas/datadog/generated/sdkLock.js";
import { datadogShapeIndexFor } from "../src/atlas/datadog/shapeIndexed.js";
import {
  type DatadogSpec,
  kindOf,
  pageSizeParameterOf,
  pagingOf,
  pagingParameterOf,
  surfaceName,
} from "../src/atlas/datadog/surfaceNaming.js";
import type { DatadogSurfaceRow } from "../src/atlas/datadog/surfaceRow.js";
import { type Extracted, extractAll, METHODS, SPECS } from "./datadogSurfacesExtract.js";

const OUTPUT = "src/atlas/datadog/generated/surfaces.ts";
const PAGING_OUTPUT = "src/atlas/datadog/generated/pagingParameters.ts";

/** Whether a parsed YAML node is a plain object, so the generator narrows rather than asserts. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the pinned specifications for the one annotation the client drops, checking parity while there.
 *
 * @param directory holds `v1.yaml` and `v2.yaml`
 * @param extracted every operation the client declares, for the parity check
 * @returns the `METHOD path` keys the specification marks deprecated
 */
function deprecatedOperations({
  directory,
  extracted,
}: {
  directory: string;
  extracted: readonly Extracted[];
}): ReadonlySet<string> {
  const declared = new Map<string, boolean>();
  for (const spec of SPECS) {
    const pin = DATADOG_SPEC_PINS[spec];
    const text = readFileSync(join(directory, `${spec}.yaml`), "utf8");
    if (Buffer.byteLength(text) !== pin.byteLength) {
      throw new Error(`${spec}.yaml: length moved — review the diff before regenerating`);
    }
    const digest = createHash("sha256").update(text).digest("hex");
    if (digest !== pin.sha256) {
      throw new Error(`${spec}.yaml: digest moved (${digest})`);
    }
    const document: unknown = parse(text);
    const paths = isRecord(document) && isRecord(document["paths"]) ? document["paths"] : {};
    for (const [pathKey, item] of Object.entries(paths)) {
      if (!isRecord(item)) {
        continue;
      }
      for (const method of METHODS) {
        const operation = item[method.toLowerCase()];
        if (isRecord(operation)) {
          declared.set(`${method} ${pathKey}`, operation["deprecated"] === true);
        }
      }
    }
  }
  const reachable = new Set(extracted.map((operation) => `${operation.method} ${operation.path}`));
  const specOnly = [...declared.keys()].filter((key) => !reachable.has(key));
  const sdkOnly = [...reachable].filter((key) => !declared.has(key));
  if (specOnly.length !== DATADOG_SPEC_PARITY.specOnly || sdkOnly.length !== DATADOG_SPEC_PARITY.sdkOnly) {
    throw new Error(
      `spec/SDK parity moved: ${String(specOnly.length)} spec-only, ${String(sdkOnly.length)} sdk-only — this is a real finding about Datadog's surface, not a build nuisance`,
    );
  }
  const deprecated = new Set([...declared.entries()].filter(([, flag]) => flag).map(([key]) => key));
  if (deprecated.size !== DATADOG_SPEC_PARITY.deprecated) {
    throw new Error(
      `deprecated census moved: ${String(deprecated.size)} vs pinned ${String(DATADOG_SPEC_PARITY.deprecated)}`,
    );
  }
  return deprecated;
}

/**
 * Turn one extracted operation into a registry row, applying the disposition policy.
 *
 * A write is decided here rather than by a row in `exclusions.ts`: 987 of these are writes, and the stated
 * reason names the RULE rather than claiming to know what each endpoint does.
 *
 * @param operation the extracted operation
 * @param spec which package declared it
 * @param deprecated every `METHOD path` the pinned specification marks deprecated
 * @returns the row, ready to serialise
 */
function rowFor({
  operation,
  spec,
  deprecated,
}: {
  operation: Extracted;
  spec: DatadogSpec;
  deprecated: ReadonlySet<string>;
}): DatadogSurfaceRow {
  const base = {
    deprecated: deprecated.has(`${operation.method} ${operation.path}`),
    kind: kindOf({ path: operation.path }),
    method: operation.method,
    name: surfaceName({ operationKey: operation.operationKey }),
    operationKey: operation.operationKey,
    paging: pagingOf({ parameterNames: operation.queryParameters }),
    path: operation.path,
    spec,
    unstable: operation.unstable,
  };
  if (operation.method !== "GET" && operation.method !== "POST") {
    return {
      ...base,
      disposition: "excluded",
      dispositionBecause: `${operation.method} changes the tenant, and this atlas only ever reads`,
      exclusionReason: "mutating",
    };
  }
  if (operation.method === "POST" && !DATADOG_OBSERVATIONAL_POSTS.includes(operation.path)) {
    return {
      ...base,
      disposition: "excluded",
      dispositionBecause:
        "POST, and not on the reviewed observational allowlist in exclusions.ts, so this atlas treats it as a write",
      exclusionReason: "mutating",
    };
  }
  const refused = datadogExclusionFor({ method: operation.method, path: operation.path });
  if (refused !== undefined) {
    return { ...base, disposition: "excluded", dispositionBecause: refused.detail, exclusionReason: refused.reason };
  }
  const excludedKind = datadogKindExclusionFor({ kind: base.kind });
  if (excludedKind !== undefined) {
    return {
      ...base,
      disposition: "excluded",
      dispositionBecause: excludedKind.detail,
      exclusionReason: excludedKind.reason,
    };
  }
  const probe = datadogProbeOnlyFor({ method: operation.method, path: operation.path });
  if (probe !== undefined) {
    return { ...base, disposition: "probe-only", dispositionBecause: probe.detail, exclusionReason: null };
  }
  const shaped = datadogShapeIndexFor({ method: operation.method, path: operation.path });
  if (shaped !== undefined) {
    return { ...base, disposition: "shape-index", dispositionBecause: shaped.detail, exclusionReason: null };
  }
  return { ...base, disposition: "entity", dispositionBecause: null, exclusionReason: null };
}

/** One row as the generated file spells it — one line, so a diff reads operation by operation. */
function serialiseRow({ row }: { row: DatadogSurfaceRow }): string {
  const fields = [
    `deprecated: ${String(row.deprecated)}`,
    `disposition: ${JSON.stringify(row.disposition)}`,
    `dispositionBecause: ${row.dispositionBecause === null ? "null" : JSON.stringify(row.dispositionBecause)}`,
    `exclusionReason: ${row.exclusionReason === null ? "null" : JSON.stringify(row.exclusionReason)}`,
    `kind: ${JSON.stringify(row.kind)}`,
    `method: ${JSON.stringify(row.method)}`,
    `name: ${JSON.stringify(row.name)}`,
    `operationKey: ${JSON.stringify(row.operationKey)}`,
    `paging: ${JSON.stringify(row.paging)}`,
    `path: ${JSON.stringify(row.path)}`,
    `spec: ${JSON.stringify(row.spec)}`,
    `unstable: ${String(row.unstable)}`,
  ];
  return `  { ${fields.join(", ")} },`;
}

/** The value of a `--flag value` argument, or `null` when it was not given. */
function argumentValue({ flag }: { flag: string }): string | null {
  const at = process.argv.indexOf(flag);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

const specDirectory = argumentValue({ flag: "--spec-dir" });
const verifyOnly = process.argv.includes("--verify");
const extracted = extractAll();

if (specDirectory === null && !verifyOnly) {
  throw new Error("--spec-dir <dir> is required to write; the specifications carry Datadog's deprecated flag");
}
if (specDirectory !== null && !existsSync(join(specDirectory, "v1.yaml"))) {
  throw new Error(`${specDirectory} does not hold v1.yaml — fetch both documents from the URLs in sdkLock.ts`);
}
const deprecated =
  specDirectory === null ? new Set<string>() : deprecatedOperations({ directory: specDirectory, extracted });

const rows = SPECS.flatMap((spec) =>
  extracted
    .filter((operation) => operation.operationKey.startsWith(`${spec}.`))
    .map((operation) => rowFor({ deprecated, operation, spec })),
).toSorted((left, right) => left.name.localeCompare(right.name));

const names = new Set(rows.map((row) => row.name));
if (names.size !== rows.length) {
  throw new Error(`surface name collision: ${String(rows.length - names.size)} duplicate(s)`);
}
if (rows.length !== extracted.length) {
  throw new Error(`${String(extracted.length - rows.length)} operation(s) matched no package prefix`);
}

const counted = (disposition: string): number => rows.filter((row) => row.disposition === disposition).length;
const kinds = [...new Set(rows.filter((row) => row.disposition === "entity").map((row) => row.kind))].toSorted(
  (left, right) => left.localeCompare(right),
);
const summary = `${String(counted("entity"))} entity, ${String(counted("shape-index"))} shape-index, ${String(counted("probe-only"))} probe-only, ${String(counted("excluded"))} excluded`;

if (verifyOnly) {
  process.stdout.write(
    `datadog surfaces: ${String(rows.length)} rows (${summary}) across ${String(kinds.length)} entity kinds — every pin and census holds${specDirectory === null ? " (SDK only; pass --spec-dir to check the specification too)" : ""}\n`,
  );
} else {
  writeFileSync(
    OUTPUT,
    `/**
 * GENERATED — do not hand-edit. Regenerate with \`yarn tsx tools/generateDatadogSurfaces.ts --spec-dir <dir>\`
 * and review the diff. Built from the artifacts pinned in \`sdkLock.ts\`.
 *
 * ${String(rows.length)} rows: ${summary}. ${String(kinds.length)} kinds carry entities.
 */
import type { DatadogSurfaceRow } from "../surfaceRow.js";

/** Every operation this atlas knows of, whatever it does with each, sorted by surface name. */
export const DATADOG_SURFACES: readonly DatadogSurfaceRow[] = [
${rows.map((row) => serialiseRow({ row })).join("\n")}
];
`,
    "utf8",
  );
  const paged = extracted
    .map((operation) => ({
      name: surfaceName({ operationKey: operation.operationKey }),
      size: pageSizeParameterOf({ parameterNames: operation.queryParameters }),
      walk: pagingParameterOf({ parameterNames: operation.queryParameters }),
    }))
    .filter((one) => one.walk !== null || one.size !== null)
    .toSorted((left, right) => left.name.localeCompare(right.name));
  writeFileSync(
    PAGING_OUTPUT,
    `/**
 * GENERATED — do not hand-edit. Regenerate with \\\`yarn tsx tools/generateDatadogSurfaces.ts --spec-dir <dir>\\\`
 * and review the diff. Built from the artifacts pinned in \\\`sdkLock.ts\\\`.
 *
 * The exact query parameter names each walking operation drives its pages with, keyed by surface name.
 *
 * ## Why these are a SIDE TABLE rather than two more fields on \\\`DatadogSurfaceRow\\\`
 *
 * They belong conceptually on the row. MEASURED: adding
 * two properties to all ${String(rows.length)} row literals pushes \\\`tsc -p tsconfig.json\\\` past node's DEFAULT
 * heap ceiling. \\\`compile\\\` runs \\\`yarn build\\\` under a declared ceiling. Only
 * ${String(paged.length)} of those rows carry either parameter at all, so holding them apart costs the checker one small
 * record instead of ${String(rows.length)} wider literals, and spends none of a shared budget that is already near its edge.
 *
 * Read one with \\\`datadogPagingParametersFor\\\` (\\\`../pagingParameters.js\\\`), never by indexing this map: a
 * surface absent here does not walk, and the accessor is where that is said once.
 */

/** One operation's paging parameter names, as the pinned client spells them. */
export interface DatadogPagingParameters {
  /** The parameter that advances the walk, or \`null\` when the operation only caps a page's size. */
  readonly walk: string | null;
  /** The parameter that caps one page's size, or \`null\` when it declares none. */
  readonly size: string | null;
}

/** Every operation that declares a paging or page-size parameter, keyed by surface name. */
export const DATADOG_PAGING_PARAMETERS: Readonly<Record<string, DatadogPagingParameters>> = {
${paged.map((one) => `  ${JSON.stringify(one.name)}: { size: ${one.size === null ? "null" : JSON.stringify(one.size)}, walk: ${one.walk === null ? "null" : JSON.stringify(one.walk)} },`).join("\n")}
};
`,
    "utf8",
  );
  process.stdout.write(
    `${String(rows.length)} rows (${summary}), ${String(kinds.length)} entity kinds, ${String(paged.length)} paging parameter row(s)\n`,
  );
}
