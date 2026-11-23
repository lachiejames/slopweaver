/**
 * Pure field readers shared by the structure connectors (projecting a raw SDK object into a typed
 * {@link StructureBronzeRow}) and by the store (parsing a persisted row back). Centralising them keeps the
 * curated `identity`/`attrs`/`relations` projection in one place — no casts, every field defensive.
 */
import { isOneOf, isRecord } from "../../lib/parsers.js";
import { optStr } from "../slack/shape.js";
import type { AttrValue, RelationType, StructureIdentityFields, StructureKind, StructureRelation } from "./types.js";

/** Runtime mirror of {@link StructureKind} for validating a persisted row's `kind`. */
export const STRUCTURE_KINDS: readonly StructureKind[] = [
  "org",
  "team",
  "repo",
  "channel",
  "usergroup",
  "workflow_state",
  "cycle",
  "data_source",
  "issue_label",
  "custom_view",
];

/** The relation types accepted on parse-back (defensive — an unknown type drops the whole relation). */
const RELATION_TYPES: readonly RelationType[] = ["member", "parent", "owns", "permission", "state_for", "cycle_for"];

/** Whether a value is a valid scalar attr value (string / number / boolean / string[]). Pure. */
function attrValue({ value }: { value: unknown }): AttrValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const list = value.filter((item): item is string => typeof item === "string");
    return list.length === value.length ? list : undefined;
  }
  return undefined;
}

/**
 * Read an `attrs`-shaped map off an unknown (non-scalar values dropped). Pure.
 *
 * @param value the raw `attrs` field, of unvalidated shape
 * @returns only the scalar entries; a nested object or array is dropped, because `attrs` is a flat bag by
 *   contract and admitting structure here would let it drift
 */
export function readAttrs({ value }: { value: unknown }): Readonly<Record<string, AttrValue>> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, AttrValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = attrValue({ value: raw });
    if (parsed !== undefined) {
      out[key] = parsed;
    }
  }
  return out;
}

/**
 * Read the curated identity fields off an unknown (nativeId degrades to "" honestly when absent). Pure.
 *
 * @param value the raw identity object, of unvalidated shape
 * @returns the identity fields; a missing `nativeId` becomes empty rather than a synthesised key, so a row
 *   that cannot be identified says so instead of colliding with another
 */
export function readStructureIdentity({ value }: { value: unknown }): StructureIdentityFields {
  const obj = isRecord(value) ? value : {};
  const name = optStr({ value: obj["name"] });
  const slug = optStr({ value: obj["slug"] });
  const url = optStr({ value: obj["url"] });
  return {
    nativeId: typeof obj["nativeId"] === "string" ? obj["nativeId"] : "",
    ...(name !== undefined ? { name } : {}),
    ...(slug !== undefined ? { slug } : {}),
    ...(url !== undefined ? { url } : {}),
  };
}

/** Read one relation off an unknown, or `undefined` when a required field is missing/typeless. Pure. */
function readRelation({ value }: { value: unknown }): StructureRelation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = value["type"];
  const targetSource = optStr({ value: value["targetSource"] });
  const targetKind = optStr({ value: value["targetKind"] });
  const targetId = optStr({ value: value["targetId"] });
  if (typeof type !== "string" || !isOneOf(type, RELATION_TYPES)) {
    return undefined;
  }
  if (targetSource === undefined || targetKind === undefined || targetId === undefined) {
    return undefined;
  }
  const attrs = readAttrs({ value: value["attrs"] });
  return {
    targetId,
    targetKind,
    targetSource,
    type,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
  };
}

/**
 * Read a relations array off an unknown (invalid entries dropped), sorted deterministically. Pure.
 *
 * @param value the raw relations field, of unvalidated shape
 * @returns the valid relations in a stable order, so two reads of the same row fingerprint identically
 */
export function readRelations({ value }: { value: unknown }): readonly StructureRelation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readRelation({ value: entry }))
    .filter((relation): relation is StructureRelation => relation !== undefined);
}

/**
 * A string array off a raw field (non-strings dropped), else empty. Pure.
 *
 * @param value the raw field, of unvalidated shape
 * @returns the strings, or empty — never undefined, since this backs a required list
 */
export function readStrArray({ value }: { value: unknown }): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
