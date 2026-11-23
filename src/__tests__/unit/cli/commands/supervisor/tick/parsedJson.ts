/** Narrowing reads of the JSON a tick writes, so a helper never asserts a type onto `JSON.parse`'s `any`. */

import { isRecord } from "#lib/parsers.js";

/**
 * The object a JSON text holds, thrown on anything else so a malformed fixture fails the case that read it.
 *
 * @param text the JSON document to parse
 * @returns the parsed object
 */
export function jsonObject({ text }: { text: string }): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new TypeError("the JSON text is not an object");
  }
  return parsed;
}

/**
 * The items one field of an object holds, thrown when that field is not an array.
 *
 * @param record the object holding the field
 * @returns the field's items
 */
export function arrayField({ key, record }: { key: string; record: Record<string, unknown> }): readonly unknown[] {
  const value: unknown = record[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`the field ${key} is not an array`);
  }
  const items: readonly unknown[] = value;
  return items;
}

/**
 * The items of an array, each proven an object, thrown on the first that is not.
 *
 * @param items the array to check element by element
 * @returns the same items, typed as objects
 */
export function objectItems({ items }: { items: readonly unknown[] }): readonly Record<string, unknown>[] {
  return items.map((item) => {
    if (!isRecord(item)) {
      throw new TypeError("an array item is not an object");
    }
    return item;
  });
}
