/**
 * One dereferenced specification node that carries no composition, classified into the one shape the merge table
 * (`responseSpec.ts`) reads: primitive, object, array, map, free or mixed. Nothing here follows a `$ref` or expands
 * a `oneOf`; `responseSpec.ts` does both and hands each resulting node here.
 */
import { isRecord } from "#lib/parsers.js";

import { type DatadogMalformedKeywordError, DatadogSpecErrors } from "./responseSpecErrors.js";
import type { DatadogSpecNode, DatadogSpecPrimitive } from "./responseSpecNode.js";

/** One dereferenced, classified arm. */
export type DatadogSpecLeaf =
  | { readonly class: "recursive" }
  | { readonly class: "free"; readonly nullable: boolean }
  | { readonly class: "mixed"; readonly nullable: boolean }
  | { readonly class: "primitive"; readonly kinds: readonly DatadogSpecPrimitive[]; readonly nullable: boolean }
  | {
      readonly class: "object";
      readonly properties: Readonly<Record<string, unknown>>;
      readonly required: readonly string[];
      readonly stack: readonly string[];
      readonly nullable: boolean;
    }
  | { readonly class: "array"; readonly items: DatadogSpecNode | null; readonly nullable: boolean }
  | { readonly class: "map"; readonly value: DatadogSpecNode | null; readonly nullable: boolean };

/** The primitive kind one specification `type` declares, `null` for a type that is not primitive. */
function primitiveOf({ type }: { type: unknown }): DatadogSpecPrimitive | null {
  if (type === "string" || type === "boolean") {
    return type;
  }
  if (type === "number" || type === "integer") {
    return "number";
  }
  return null;
}

/** The primitive kinds an untyped enum's own values carry. */
function enumKinds({ values }: { values: readonly unknown[] }): readonly DatadogSpecPrimitive[] {
  const kinds = new Set<DatadogSpecPrimitive>();
  for (const value of values) {
    const kind = primitiveOf({ type: typeof value });
    if (kind !== null) {
      kinds.add(kind);
    }
  }
  return [...kinds];
}

/**
 * The primitive kinds and null a `type` of `"null"`, or a list of primitive and `"null"` types, declares; `null`
 * for any other `type` — a list naming `object` or `array` included, which `datadogSpecLeaf` reads before this.
 */
function typeList({ type }: { type: unknown }): { kinds: readonly DatadogSpecPrimitive[]; nullable: boolean } | null {
  const types: readonly unknown[] = Array.isArray(type) ? type : [type];
  const kinds = types.map((each) => primitiveOf({ type: each })).filter((kind) => kind !== null);
  const nulls = types.filter((each) => each === "null").length;
  if (types.length === 0 || kinds.length + nulls !== types.length) {
    return null;
  }
  return { kinds: [...new Set(kinds)], nullable: nulls > 0 };
}

/**
 * Why one node's structural keyword is not of the JSON type {@link datadogSpecLeaf} reads it as. Read as absent
 * instead, a closed `items: false` would be an array declaring nothing below it, and so free.
 *
 * @returns what is malformed, or `null` when every structural keyword present is of its JSON type
 */
export function datadogMalformedKeyword({
  node,
}: {
  node: Readonly<Record<string, unknown>>;
}): DatadogMalformedKeywordError | null {
  const { additionalProperties, items, properties, required } = node;
  if (properties !== undefined && !isRecord(properties)) {
    return DatadogSpecErrors.malformedKeyword({ keyword: "properties" });
  }
  if (required !== undefined && !(Array.isArray(required) && required.every((key) => typeof key === "string"))) {
    return DatadogSpecErrors.malformedKeyword({ keyword: "required" });
  }
  if (
    additionalProperties !== undefined &&
    typeof additionalProperties !== "boolean" &&
    !isRecord(additionalProperties)
  ) {
    return DatadogSpecErrors.malformedKeyword({ keyword: "additionalProperties" });
  }
  if (items !== undefined && !isRecord(items)) {
    return DatadogSpecErrors.malformedKeyword({ keyword: "items" });
  }
  return null;
}

/**
 * Classify one dereferenced node that carries no composition, its structural keywords already checked by
 * {@link datadogMalformedKeyword}.
 *
 * @param node the node, an object
 * @param stack the components on its path from the response root, which an object or array leaf carries down
 * @returns the one shape the node declares
 */
export function datadogSpecLeaf({
  node,
  stack,
}: {
  node: Readonly<Record<string, unknown>>;
  stack: readonly string[];
}): DatadogSpecLeaf {
  const { type, nullable, twoShapes } = declaredType({ node });
  if (twoShapes) {
    return { class: "free", nullable };
  }
  // Object keywords constrain only an object, so a `type` naming anything else (null alone included) ignores them.
  if (type === undefined || type === "object") {
    const object = objectLeaf({ node, nullable, stack, type });
    if (object !== null) {
      return object;
    }
  }
  if (type === "array") {
    return { class: "array", items: isRecord(node["items"]) ? { node: node["items"], stack } : null, nullable };
  }
  return scalarLeaf({ node, nullable, type });
}

/**
 * The one type a node's `type` names, whether it admits null, and whether it names two shapes, one structural. A
 * type list declares null by naming it, whatever else it names; one naming a structural type beside another type
 * declares no single shape, and one structural type beside null is that type.
 */
function declaredType({ node }: { node: Readonly<Record<string, unknown>> }): {
  readonly type: unknown;
  readonly nullable: boolean;
  readonly twoShapes: boolean;
} {
  const listed: readonly unknown[] | null = Array.isArray(node["type"]) ? node["type"] : null;
  const nullable = node["nullable"] === true || listed?.includes("null") === true;
  if (listed === null) {
    return { nullable, twoShapes: false, type: node["type"] };
  }
  // A type named twice is named once; only two different types declare no single shape.
  const named = [...new Set(listed.filter((each) => each !== "null"))];
  const twoShapes = named.length > 1 && named.some((each) => each === "object" || each === "array");
  return { nullable, twoShapes, type: named.length === 1 ? named[0] : node["type"] };
}

/** {@link datadogSpecLeaf}'s reading of an object-typed node: mixed, an object, a map, or `null` for none of them. */
function objectLeaf({
  node,
  type,
  nullable,
  stack,
}: {
  node: Readonly<Record<string, unknown>>;
  type: unknown;
  nullable: boolean;
  stack: readonly string[];
}): DatadogSpecLeaf | null {
  const properties = node["properties"];
  const required = Array.isArray(node["required"]) ? node["required"].filter((key) => typeof key === "string") : [];
  // A name an object's `required` lists is declared as surely as one `properties` lists, so either names its fields.
  const listsNames = (isRecord(properties) && Object.keys(properties).length > 0) || required.length > 0;
  const extras = node["additionalProperties"];
  const declaresExtras = extras === true || isRecord(extras);
  if (listsNames && declaresExtras) {
    return { class: "mixed", nullable };
  }
  // An object closed to every key but those it names holds strictly even when it names none.
  const closed = extras === false && (type === "object" || isRecord(properties));
  if (listsNames || closed) {
    // A required name `properties` omits is still declared, its value constrained by nothing.
    const declared = isRecord(properties) ? properties : {};
    const unnamed = required.filter((key) => !Object.hasOwn(declared, key)).map((key) => [key, {}]);
    return { class: "object", nullable, properties: { ...declared, ...Object.fromEntries(unnamed) }, required, stack };
  }
  if (declaresExtras) {
    return { class: "map", nullable, value: isRecord(extras) ? { node: extras, stack } : null };
  }
  return null;
}

/** {@link datadogSpecLeaf}'s reading of a node that declares no structure: a primitive, an enum, or free. */
function scalarLeaf({
  node,
  type,
  nullable,
}: {
  node: Readonly<Record<string, unknown>>;
  type: unknown;
  nullable: boolean;
}): DatadogSpecLeaf {
  const primitive = primitiveOf({ type });
  if (primitive !== null) {
    return { class: "primitive", kinds: [primitive], nullable };
  }
  const types = typeList({ type: node["type"] });
  if (types !== null) {
    return { class: "primitive", kinds: types.kinds, nullable: nullable || types.nullable };
  }
  if (node["type"] === undefined && Array.isArray(node["enum"])) {
    // An object or array value is literal structure no strict declaration spells, so the enum is free.
    if (node["enum"].some((value) => typeof value === "object" && value !== null)) {
      return { class: "free", nullable };
    }
    // `typeof null` is "object", so a null value is the enum declaring null rather than a primitive kind.
    const declaresNull = node["enum"].includes(null);
    return { class: "primitive", kinds: enumKinds({ values: node["enum"] }), nullable: nullable || declaresNull };
  }
  return { class: "free", nullable };
}

/**
 * Whether a leaf declares only null, which is no arm: the merged view carries it as `nullable`.
 *
 * @returns `true` for a primitive leaf of no kind that admits null
 */
export function datadogNullOnly({ leaf }: { leaf: DatadogSpecLeaf }): boolean {
  return leaf.class === "primitive" && leaf.kinds.length === 0 && leaf.nullable;
}
