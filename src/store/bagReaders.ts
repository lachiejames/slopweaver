/**
 * The readers that take one typed value off an untyped bag — a record's `raw` payload or its `attrs`.
 *
 * A leaf of {@link ./project.js}: each answers `null` (or `undefined`, or `[]`) for a key that is absent or
 * carries another type, so a projector reads a provider's payload without trusting its shape.
 */
import { isRecord } from "#lib/parsers.js";

/**
 * Read one key off an untyped bag as a string, when it holds one.
 *
 * @param bag the untyped object, typically a record's `raw` or `attrs`
 * @param key which key to read
 * @returns the string value, or `null` when absent or another type
 */
export function str({ bag, key }: { bag: Readonly<Record<string, unknown>> | undefined; key: string }): string | null {
  const value = bag?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read one key off an untyped bag as a finite number.
 *
 * @param bag the untyped object
 * @param key which key to read
 * @returns the number, or `null` when absent or another type
 */
export function num({ bag, key }: { bag: Readonly<Record<string, unknown>> | undefined; key: string }): number | null {
  const value = bag?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Read one key off an untyped bag as an instant.
 *
 * @param bag the untyped object
 * @param key which key holds an ISO timestamp
 * @returns the date, or `null` when absent or unparseable
 */
export function when({ bag, key }: { bag: Readonly<Record<string, unknown>> | undefined; key: string }): Date | null {
  const value = str({ bag, key });
  if (value === null) {
    return null;
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Read one key off an untyped bag as a nested object.
 *
 * @param bag the untyped object
 * @param key which key holds the nested object
 * @returns the nested object, or `undefined` when absent or another type
 */
export function obj({
  bag,
  key,
}: {
  bag: Readonly<Record<string, unknown>> | undefined;
  key: string;
}): Readonly<Record<string, unknown>> | undefined {
  const value = bag?.[key];
  return isRecord(value) ? value : undefined;
}

/**
 * Collect one named string field off every member of an array-valued key.
 *
 * The shape three of the four sources use for their lists — GitHub's `labels[].name` and
 * `assignees[].login`, Linear's `labels.nodes[].name` — so it is written once rather than three times.
 *
 * @param items the array to read, from wherever the caller found it
 * @param field which field on each member carries the name
 * @returns every non-empty value, in order, with duplicates kept because their order is the source's
 */
export function names({ items, field }: { items: unknown; field: string }): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const out: string[] = [];
  for (const item of items) {
    const value = isRecord(item) ? item[field] : undefined;
    if (typeof value === "string" && value.length > 0) {
      out.push(value);
    }
  }
  return out;
}
