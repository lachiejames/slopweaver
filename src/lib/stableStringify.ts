/**
 * A canonical (recursively key-sorted) JSON serialisation, so key ORDER never affects equality — the shape
 * a content fingerprint needs when a row can be re-hydrated with its keys in a different order than the one
 * it was first written in. Reimplemented identically in the structure-bronze and member-bronze stores before
 * this extraction. Pure.
 */

import { isRecord } from "./parsers.js";

/**
 * Recursively serialise a value with object keys sorted, so two values carrying equal data always produce
 * identical bytes regardless of key insertion order. Pure.
 *
 * @param value the value to serialise
 * @returns a JSON string; `undefined` (which `JSON.stringify` would drop) maps to a stable `"null"` sentinel
 *   so a field PRESENT with value `undefined` serialises like an explicit null. A key that is ABSENT is
 *   omitted, so `{ b: 1 }` and `{ a: null, b: 1 }` still produce different bytes
 */
export function stableStringify({ value }: { value: unknown }): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify({ value: item })).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableStringify({ value: value[key] })}`);
    return `{${entries.join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}
