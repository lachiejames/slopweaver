/**
 * Turn one surface's structural census (`responseCensus.ts`) into the TypeScript source of its strict response
 * boundary (`responseBoundary.ts`). Pure: `tools/generateJumpcloudResponseBoundaries.ts` does the reading and the
 * writing, and every rule about what a measurement declares lives here, under test.
 *
 * ## What a measurement declares
 *
 * - **The carrier** is `carrierCodegen.ts`'s: the one every 2xx answer arrived in, never a pick between two.
 * - **A key is required** exactly when it was present on every object seen at its parent, and optional otherwise.
 * - **A key's type** is the union of the kinds measured there, `.nullable()` when `null` was one of them. A key only
 *   ever measured `null` is `z.null()`, and an array only ever measured empty is `z.array(z.never())`: neither says
 *   anything about what a value would be, so the first one to arrive is refused by name rather than admitted unread.
 *   A number too large for JSON to read back parses to `Infinity`, which no number schema admits, so it is refused.
 * - **A data-keyed map** — every key a census placeholder — is a `z.record`. A map mixing placeholders and field
 *   names, and a key the census recorded as `<unsafe>`, is refused.
 * - **A named document field** (`responseDocumentPaths.ts`) is `z.unknown()`, required or optional as measured,
 *   and nothing below it is read: its keys are an author's content, not the provider's contract.
 *
 * ## A surface no answer measured
 *
 * A by-id read the tenant holds nothing for is never answered, so its carrier comes from the published document
 * instead (`jumpcloudCarrierFromSpec`) and its record refuses every record, `{}` included: the first record that arrives
 * is refused naming every key it carries, which is the measurement this surface is still owed.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ResponseJsonKind, responseCensusKeyShape } from "../kit/responseStructure.js";

import { type JumpcloudDeclaredCarrier, jumpcloudCarrierFromCensus } from "./carrierCodegen.js";
import { type JumpcloudCodegenError, JumpcloudCodegenErrors } from "./codegenErrors.js";
import type { JumpcloudResponseCensus, JumpcloudSurfaceCensus } from "./responseCensus.js";

/** One census path's position: the parent it hangs off, and the key it is there — `null` for an array's items. */
function parentOf({ path }: { path: string }): { readonly parent: string; readonly key: string | null } {
  if (path.endsWith("[]")) {
    return { key: null, parent: path.slice(0, -2) };
  }
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return { key: path, parent: "" };
  }
  return { key: path.slice(dot + 1), parent: path.slice(0, dot) };
}

/** The key names measured directly under each object path. */
function childKeys({ stat }: { stat: JumpcloudSurfaceCensus }): ReadonlyMap<string, readonly string[]> {
  const children = new Map<string, string[]>();
  for (const path of Object.keys(stat.paths)) {
    const { parent, key } = parentOf({ path });
    if (key === null) {
      continue;
    }
    const siblings = children.get(parent);
    if (siblings === undefined) {
      children.set(parent, [key]);
    } else {
      siblings.push(key);
    }
  }
  return children;
}

/** What every source builder below reads. */
interface Measured {
  readonly surface: string;
  readonly stat: JumpcloudSurfaceCensus;
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** The census paths declared `z.unknown()` and never descended into. */
  readonly documentPaths: ReadonlySet<string>;
}

/** A key as an object-literal property name: bare when it is an identifier, quoted otherwise. */
function propertyName({ key }: { key: string }): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

/** Join an object path and one of its keys into the key's path. */
function childPath({ parent, key }: { parent: string; key: string }): string {
  return parent === "" ? key : `${parent}.${key}`;
}

/** The scalar kinds, in the order a union lists them. */
const SCALARS: readonly (readonly [ResponseJsonKind, string])[] = [
  ["boolean", "z.boolean()"],
  ["number", "z.number()"],
  ["string", "z.string()"],
];

/** The schema source for every value measured at one path. */
function valueSource({ measured, path }: { measured: Measured; path: string }): Result<string, JumpcloudCodegenError> {
  if (measured.documentPaths.has(path)) {
    return ok("z.unknown()");
  }
  const kinds = measured.stat.paths[path]!.kinds;
  if (kinds["non-finite"] !== undefined) {
    return err(JumpcloudCodegenErrors.nonFiniteNumber({ path, surface: measured.surface }));
  }
  const parts: string[] = [];
  if (kinds.array !== undefined) {
    const array = arraySource({ measured, path });
    if (array.isErr()) {
      return array;
    }
    parts.push(array.value);
  }
  for (const [kind, source] of SCALARS) {
    if (kinds[kind] !== undefined) {
      parts.push(source);
    }
  }
  if (kinds.object !== undefined) {
    const object = objectArmSource({ besideOthers: parts.length > 0, measured, path });
    if (object.isErr()) {
      return object;
    }
    parts.push(object.value);
  }
  return ok(withNull({ nullable: kinds.null !== undefined, parts }));
}

/** The array arm at one path: its measured items, or `z.never()` items when every array seen there was empty. */
function arraySource({ measured, path }: { measured: Measured; path: string }): Result<string, JumpcloudCodegenError> {
  const items = `${path}[]`;
  if (measured.stat.paths[items] === undefined) {
    return ok("z.array(z.never())");
  }
  return valueSource({ measured, path: items }).map((item) => `z.array(${item})`);
}

/**
 * The object arm at one path. A record keys anything, and `defineBoundary` refuses a union beside such an arm: no
 * read could say which arm, so a data-keyed map measured beside another kind is refused.
 */
function objectArmSource({
  besideOthers,
  measured,
  path,
}: {
  besideOthers: boolean;
  measured: Measured;
  path: string;
}): Result<string, JumpcloudCodegenError> {
  const isMap = measured.children.get(path)?.some((key) => key.startsWith("<")) === true;
  if (isMap && besideOthers) {
    const why = "a data-keyed map measured beside another kind, a union no boundary can tell apart";
    return err(JumpcloudCodegenErrors.undeclarableKey({ path, surface: measured.surface, why }));
  }
  return objectSource({ measured, path });
}

/** One union of measured kinds, `.nullable()` when `null` was one of them, `z.null()` when it was the only one. */
function withNull({ parts, nullable }: { parts: readonly string[]; nullable: boolean }): string {
  if (parts.length === 0) {
    return "z.null()";
  }
  const union = parts.length === 1 ? parts[0]! : `z.union([${parts.join(", ")}])`;
  return nullable ? `${union}.nullable()` : union;
}

/**
 * A data-keyed map's schema source: a record whose keys are held to the one key shape measured, and whose values
 * are what was measured under it. A map whose keys took more than one shape is refused rather than declared, since
 * a record could not pair each shape with its own values.
 *
 * An EMPTY map is admitted even where every measured one held a key, by design and by necessity. A data-keyed map
 * is a collection keyed by data, so emptying it is the tenant's act exactly as emptying an array is, and no key in
 * it is a field to require. Nor could one be: `defineBoundary` admits no size bound on a record and refuses the
 * custom check a non-empty rule would need.
 */
function recordSource({
  measured,
  path,
  keys,
}: {
  measured: Measured;
  path: string;
  keys: readonly string[];
}): Result<string, JumpcloudCodegenError> {
  const [placeholder, ...others] = keys;
  if (placeholder === undefined || others.length > 0) {
    const why = "keys of more than one data shape in one map";
    return err(JumpcloudCodegenErrors.undeclarableKey({ path, surface: measured.surface, why }));
  }
  const shape = responseCensusKeyShape({ placeholder });
  if (shape === null) {
    const why = `no key shape behind ${placeholder}`;
    return err(JumpcloudCodegenErrors.undeclarableKey({ path, surface: measured.surface, why }));
  }
  return valueSource({ measured, path: childPath({ key: placeholder, parent: path }) }).map(
    (value) => `z.record(z.string().regex(${shape.toString()}), ${value})`,
  );
}

/** The schema source of the objects measured at one path. */
function objectSource({ measured, path }: { measured: Measured; path: string }): Result<string, JumpcloudCodegenError> {
  const keys = measured.children.get(path);
  // Objects were measured here with no key in any of them.
  if (keys === undefined) {
    return ok("z.strictObject({})");
  }
  if (keys.includes("<unsafe>")) {
    const why = "a key no path or schema can carry: path notation, empty, or an Object.prototype name";
    return err(JumpcloudCodegenErrors.undeclarableKey({ path, surface: measured.surface, why }));
  }
  const placeholders = keys.filter((key) => key.startsWith("<"));
  if (placeholders.length > 0 && placeholders.length < keys.length) {
    const why = "data-shaped keys beside field names";
    return err(JumpcloudCodegenErrors.undeclarableKey({ path, surface: measured.surface, why }));
  }
  // The root of a single-object answer is the object boundary's own schema, which must be an object, never a record.
  if (placeholders.length > 0 && path === "") {
    const why = "a data-keyed map as the whole answer, which an object boundary cannot carry";
    return err(JumpcloudCodegenErrors.undeclarableKey({ path, surface: measured.surface, why }));
  }
  if (placeholders.length > 0) {
    return recordSource({ keys, measured, path });
  }
  const objects = measured.stat.objects[path]!;
  const fields: string[] = [];
  for (const key of keys.toSorted()) {
    const child = childPath({ key, parent: path });
    const value = valueSource({ measured, path: child });
    if (value.isErr()) {
      return value;
    }
    const required = measured.stat.paths[child]!.present === objects;
    fields.push(`${propertyName({ key })}: ${value.value}${required ? "" : ".optional()"}`);
  }
  return ok(`z.strictObject({ ${fields.join(", ")} })`);
}

/**
 * The record schema an unmeasured collection or object declares: it refuses every record, `{}` included, so the
 * first one to arrive is drift. A required key no value satisfies does that inside a strict object — the object
 * carrier is declared over one, and `defineBoundary` refuses a custom check — and the drift report names the key.
 */
const UNMEASURED_RECORD = "z.strictObject({ noRecordWasEverMeasuredHere: z.never() })";

/**
 * Every census entry filed under a name no paged surface carries. The census files an answer whose path no row
 * matched, or two rows tie on, under such a name rather than guessing a surface, and what it measured is declared by
 * no boundary — so generation refuses it rather than writing a registry that never looked.
 *
 * @param census the census, by the name each answer was filed under
 * @param paged every surface a production read pages
 * @returns one refusal per entry no paged surface carries, in name order
 */
export function jumpcloudUnroutedCensus({
  census,
  paged,
}: {
  census: JumpcloudResponseCensus;
  paged: ReadonlySet<string>;
}): readonly JumpcloudCodegenError[] {
  return Object.keys(census)
    .filter((surface) => !paged.has(surface))
    .toSorted()
    .map((surface) => JumpcloudCodegenErrors.unroutedAnswer({ surface }));
}

/**
 * The source of one surface's `defineJumpcloud…Boundary` call.
 *
 * @param surface the registry surface the boundary admits
 * @param stat the surface's census, or `undefined` when the census never saw it answer
 * @param specCarrier the carrier the published document declares, read only when no 2xx answer was measured
 * @param documentPaths this surface's census paths declared unread, `responseDocumentPaths.ts`'s, none for most
 * @returns the call's source, or why this surface's boundary cannot be generated
 */
export function jumpcloudBoundarySource({
  documentPaths,
  surface,
  stat,
  specCarrier,
}: {
  documentPaths: ReadonlySet<string>;
  surface: string;
  stat: JumpcloudSurfaceCensus | undefined;
  specCarrier: () => Result<JumpcloudDeclaredCarrier, JumpcloudCodegenError>;
}): Result<string, JumpcloudCodegenError> {
  const carrier = stat === undefined ? ok(null) : jumpcloudCarrierFromCensus({ stat, surface });
  if (carrier.isErr()) {
    return err(carrier.error);
  }
  if (carrier.value === null || stat === undefined) {
    return specCarrier().map((declared) => callSource({ carrier: declared, record: UNMEASURED_RECORD, surface }));
  }
  const measured: Measured = { children: childKeys({ stat }), documentPaths, stat, surface };
  const record = recordOf({ carrier: carrier.value, measured });
  if (record.isErr()) {
    return err(record.error);
  }
  return ok(callSource({ carrier: carrier.value, record: record.value, surface }));
}

/** The schema source of one record in a measured carrier — the item of a collection, or the whole object. */
function recordOf({
  carrier,
  measured,
}: {
  carrier: JumpcloudDeclaredCarrier;
  measured: Measured;
}): Result<string, JumpcloudCodegenError> {
  if (carrier.kind === "empty") {
    return ok("");
  }
  if (carrier.kind === "single-object") {
    return objectSource({ measured, path: "" });
  }
  const items = carrier.kind === "bare-array" ? "[]" : "results[]";
  if (measured.stat.paths[items] === undefined) {
    return ok(UNMEASURED_RECORD);
  }
  return valueSource({ measured, path: items });
}

/** One constructor call, its fields in key order. */
function callSource({
  carrier,
  record,
  surface,
}: {
  carrier: JumpcloudDeclaredCarrier;
  record: string;
  surface: string;
}): string {
  const name = JSON.stringify(surface);
  switch (carrier.kind) {
    case "bare-array":
      return `defineJumpcloudArrayBoundary({ item: ${record}, surface: ${name} })`;
    case "wrapped":
      return `defineJumpcloudWrappedBoundary({ envelope: "${carrier.envelope}", item: ${record}, surface: ${name} })`;
    case "single-object":
      return `defineJumpcloudObjectBoundary({ object: ${record}, surface: ${name} })`;
    case "empty":
      return `defineJumpcloudEmptyBoundary({ surface: ${name} })`;
    default: {
      const unreachable: never = carrier;
      return unreachable;
    }
  }
}
