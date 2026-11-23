/**
 * The record shapes, registry checks and rendering behind `tools/generateNightfallSurfaces.ts`.
 *
 * Pure helpers split out of the generator so it stays under the file-size cap. This module never imports the
 * generator, which runs `main()` at import.
 */
import { nightfallObservationalKinds } from "../src/atlas/nightfall/dispositions.js";
import {
  NIGHTFALL_DISPOSITION_CENSUS,
  NIGHTFALL_OPERATION_CENSUS,
  NIGHTFALL_SPEC_PINS,
} from "../src/atlas/nightfall/generated/specLock.js";
import type { NightfallSurfaceRow } from "../src/atlas/nightfall/surfaceRow.js";
import { isRecord, type LoadedSpec, resolveSchema, schemaFieldNames, successSchema } from "./nightfallSurfacesSpec.js";

/**
 * The component schema one kind's records are declared as, and every field name it carries.
 *
 * This is the half of a shape index that needs no credential at all. `GET /violations` returns
 * `{violations: Violation[], nextPageToken}`; the envelope's field names say nothing about what a violation
 * IS, and the vendor's own `Violation` component says everything. So the registry carries both: the
 * envelope on the operation row, and the RECORD shape here, one per kind.
 *
 * It is what makes eighteen otherwise-empty kind files answer a real question offline — "what does
 * Nightfall hold about an endpoint device" — while the disposition still decides whether a ROW is ever
 * stored. A shape is not a record: no instant, no person, no detected content, nothing that grows.
 */
export interface NightfallRecordShape {
  /** Every field name the component declares, sorted. */
  readonly fields: readonly string[];
  readonly kind: string;
  /** The vendor's own component name, e.g. `Violation` — the handle back into the document. */
  readonly schemaName: string;
  /** The operation whose declared response carried it, so the derivation is reproducible. */
  readonly sourceOperation: string;
}

/** The `$ref` component name a schema names, directly or as an array's items. `null` when it names none. */
function referencedSchemaName({ schema }: { schema: unknown }): string | null {
  if (!isRecord(schema)) {
    return null;
  }
  const ref = schema["$ref"];
  if (typeof ref === "string") {
    return ref.split("/").at(-1) ?? null;
  }
  if (schema["type"] === "array") {
    return referencedSchemaName({ schema: schema["items"] });
  }
  return null;
}

/**
 * The record component one operation's declared success response carries, if it carries exactly one.
 *
 * Reads the envelope's own properties and takes the single one that resolves to a named component. A
 * response naming two different components is ambiguous about which is THE record, so it contributes
 * nothing rather than a guess — `GET /devices/{deviceId}` is that case, returning both a device and its
 * MCP servers, and the plain `GET /devices` beside it is unambiguous.
 *
 * @param operation the operation object
 * @param spec the document it came from
 * @returns the component name and its field names, or `null` when the response names none or several
 */
function recordShapeOf({
  operation,
  spec,
}: {
  operation: Record<string, unknown>;
  spec: LoadedSpec;
}): { schemaName: string; fields: readonly string[] } | null {
  const envelope = resolveSchema({ schema: successSchema({ operation }), spec });
  const direct = referencedSchemaName({ schema: successSchema({ operation }) });
  if (direct !== null) {
    return {
      fields: schemaFieldNames({ schema: { $ref: `#/components/schemas/${direct}` }, spec }),
      schemaName: direct,
    };
  }
  if (!isRecord(envelope)) {
    return null;
  }
  const properties = envelope["properties"];
  if (!isRecord(properties)) {
    return null;
  }
  const named = new Set<string>();
  for (const value of Object.values(properties)) {
    const name = referencedSchemaName({ schema: value });
    if (name !== null) {
      named.add(name);
    }
  }
  if (named.size !== 1) {
    return null;
  }
  const schemaName = [...named][0] ?? "";
  return {
    fields: schemaFieldNames({ schema: { $ref: `#/components/schemas/${schemaName}` }, spec }),
    schemaName,
  };
}

/**
 * One record shape per kind, taken from that kind's least-parameterised readable operation.
 *
 * Fewest path parameters first, then GET before a write, so `GET /violations` decides the `violation` shape
 * rather than `GET /violations/{id}/activity`. A kind whose every operation names no single component
 * contributes nothing, which is reported rather than defaulted — `generateNightfallSurfaces.ts --verify`
 * asserts the count.
 *
 * @param specs every loaded document
 * @param rows the extracted registry, which decides each operation's kind
 * @returns one shape per kind that has one, sorted by kind
 */
export function recordShapes({
  specs,
  rows,
}: {
  specs: readonly LoadedSpec[];
  rows: readonly NightfallSurfaceRow[];
}): readonly NightfallRecordShape[] {
  const byKind = new Map<string, NightfallRecordShape>();
  const ranked = [...rows].toSorted((left, right) => {
    const byParams = left.pathParams.length - right.pathParams.length;
    if (byParams !== 0) {
      return byParams;
    }
    if (left.method !== right.method) {
      return left.method === "GET" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  for (const row of ranked) {
    if (byKind.has(row.kind)) {
      continue;
    }
    const spec = specs.find((candidate) => candidate.document === row.specDocument);
    if (spec === undefined) {
      continue;
    }
    const paths = spec.json["paths"];
    const item = isRecord(paths) ? paths[row.path] : null;
    const operation = isRecord(item) ? item[row.method.toLowerCase()] : null;
    if (!isRecord(operation)) {
      continue;
    }
    const shape = recordShapeOf({ operation, spec });
    if (shape === null || shape.fields.length === 0) {
      continue;
    }
    byKind.set(row.kind, {
      fields: shape.fields,
      kind: row.kind,
      schemaName: shape.schemaName,
      sourceOperation: row.name,
    });
  }
  return [...byKind.values()].toSorted((left, right) => left.kind.localeCompare(right.kind));
}

/**
 * Check the whole registry against every census and invariant that does not need the vendor's bytes.
 *
 * This is what `--verify` runs on its own, so it must be able to fail on the things a bad EDIT does: a row
 * changing disposition, a duplicated name, a kind nobody declared, an observational kind left unused.
 *
 * @param rows the registry to check
 */
export function verifyRegistry({ rows }: { rows: readonly NightfallSurfaceRow[] }): void {
  if (rows.length !== NIGHTFALL_OPERATION_CENSUS) {
    throw new Error(`census: ${rows.length} operations, specLock says ${NIGHTFALL_OPERATION_CENSUS}`);
  }
  const names = new Set(rows.map((row) => row.name));
  if (names.size !== rows.length) {
    throw new Error(`census: ${rows.length} rows but ${names.size} distinct names — a name collides`);
  }
  const providerIds = new Set(rows.map((row) => `${row.method} ${row.server}${row.path}`));
  if (providerIds.size !== rows.length) {
    throw new Error(`census: ${rows.length} rows but ${providerIds.size} distinct provider keys`);
  }
  for (const pin of NIGHTFALL_SPEC_PINS) {
    const declared = rows.filter((row) => row.specDocument === pin.document).length;
    if (declared !== pin.operations) {
      throw new Error(`${pin.document}: ${declared} operations extracted, pin says ${pin.operations}`);
    }
  }
  for (const [disposition, expected] of Object.entries(NIGHTFALL_DISPOSITION_CENSUS)) {
    const counted = rows.filter((row) => row.disposition === disposition).length;
    if (counted !== expected) {
      throw new Error(`disposition census: ${counted} ${disposition} rows, specLock says ${expected}`);
    }
  }
  const kinds = new Set(rows.map((row) => row.kind));
  for (const kind of nightfallObservationalKinds()) {
    if (!kinds.has(kind)) {
      throw new Error(`observational kind ${kind} names nothing in the registry — dispositions.ts is stale`);
    }
  }
  for (const row of rows) {
    if (row.disposition === "entity" && row.dispositionBecause !== null) {
      throw new Error(`${row.name}: an entity row carries a dispositionBecause`);
    }
    if (row.disposition !== "excluded" && row.exclusionReason !== null) {
      throw new Error(`${row.name}: a non-excluded row carries an exclusionReason`);
    }
    if (row.disposition === "excluded" && row.exclusionReason === null) {
      throw new Error(`${row.name}: an excluded row names no reason`);
    }
  }
}

/**
 * Render the registry and the record shapes as the committed module.
 *
 * @param rows the registry rows
 * @param shapes the record shapes
 * @returns the full text of the generated module
 */
export function render({
  rows,
  shapes,
}: {
  rows: readonly NightfallSurfaceRow[];
  shapes: readonly NightfallRecordShape[];
}): string {
  const sorted = [...rows].toSorted((left, right) => left.name.localeCompare(right.name));
  const header = [
    "/**",
    " * The closed registry of every operation Nightfall's six published API documents declare.",
    " *",
    " * GENERATED by `tools/generateNightfallSurfaces.ts` from the documents pinned in `specLock.ts`. Do not edit:",
    " * a hand-edited row is a row no census caught, and the generator asserts every count on every run.",
    " *",
    " * The row TYPE and its field meanings are `../surfaceRow.ts`; the disposition rule is `../dispositions.ts`.",
    " */",
    'import type { NightfallSurfaceRow } from "../surfaceRow.js";',
    "",
    "/** Every operation the vendor publishes, sorted by name. */",
    "export const NIGHTFALL_SURFACES: readonly NightfallSurfaceRow[] = [",
  ].join("\n");
  const body = sorted.map((row) => `  ${JSON.stringify(row)},`).join("\n");
  const shapeHeader = [
    "",
    "/**",
    " * What one record of each kind DECLARES, from the vendor's own component schemas — the half of a shape",
    " * index that needs no credential. See `NightfallRecordShape` in `tools/generateNightfallSurfaces.ts`.",
    " */",
    "export const NIGHTFALL_RECORD_SHAPES: readonly {",
    "  readonly fields: readonly string[];",
    "  readonly kind: string;",
    "  readonly schemaName: string;",
    "  readonly sourceOperation: string;",
    "}[] = [",
  ].join("\n");
  const shapeBody = shapes.map((shape) => `  ${JSON.stringify(shape)},`).join("\n");
  return `${header}\n${body}\n];\n${shapeHeader}\n${shapeBody}\n];\n`;
}
