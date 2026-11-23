/**
 * The small readers every `github exposure` text extractor shares: the string fields of one item as texts, an array
 * field's records, and the parts a locator is built from. Each is pure, and each answers `?` or nothing rather than
 * failing when GitHub's answer lacks the field, because a locator names what it could.
 */

import { isRecord } from "../../lib/parsers.js";
import { numberAt, stringAt } from "./exposureListing.js";
import type { GithubExposureSurfaceId } from "./exposureModel.js";
import type { GithubExposureText } from "./exposureTexts.js";

/** The route parameters a call was made with, which name the parent of a fanned-out item. */
export type GithubExposureParams = Readonly<Record<string, string | number>>;

/**
 * Every non-empty string field of one item at the given paths, as texts.
 *
 * @param surface where the texts are published
 * @param locator the object they sit on
 * @param item the item GitHub answered
 * @param fields each field's path into the item
 * @returns one text per non-empty string field, named by its dotted path
 */
export function textsAt({
  surface,
  locator,
  item,
  fields,
}: {
  surface: GithubExposureSurfaceId;
  locator: string;
  item: unknown;
  fields: readonly (readonly string[])[];
}): GithubExposureText[] {
  return fields.flatMap((path) => {
    const text = stringAt({ path, value: item });
    return text === undefined || text.length === 0 ? [] : [{ field: path.join("."), locator, surface, text }];
  });
}

/**
 * The records of an array field.
 *
 * @param item the object holding the field
 * @param key the field's name
 * @returns its elements, or none when the field is absent or not an array
 */
export function recordsAt({ item, key }: { item: unknown; key: string }): readonly unknown[] {
  return isRecord(item) && Array.isArray(item[key]) ? item[key] : [];
}

/**
 * A string field as a locator part.
 *
 * @param item the object holding the field
 * @param path the field's path into it
 * @returns the value, or `?` when the item has none
 */
export function stringPart({ item, path }: { item: unknown; path: readonly string[] }): string {
  const value = stringAt({ path, value: item });
  if (value === undefined) {
    return "?";
  }
  return value;
}

/**
 * A number field as a locator part.
 *
 * @param item the object holding the field
 * @param path the field's path into it
 * @returns the value as text, or `?` when the item has none
 */
export function numberPart({ item, path }: { item: unknown; path: readonly string[] }): string {
  const value = numberAt({ path, value: item });
  if (value === undefined) {
    return "?";
  }
  return String(value);
}

/**
 * An item's numeric `id` as a locator part.
 *
 * @param item the object GitHub answered
 * @returns the id as text, or `?`
 */
export function idOf({ item }: { item: unknown }): string {
  return numberPart({ item, path: ["id"] });
}

/**
 * The last path segment of a URL field: the issue or pull number an `issue_url` ends in.
 *
 * @param item the object holding the URL
 * @param key the URL field's name
 * @returns the segment, or `?` when the field is absent
 */
export function tailOf({ item, key }: { item: unknown; key: string }): string {
  const url = stringAt({ path: [key], value: item });
  if (url === undefined) {
    return "?";
  }
  return url.slice(url.lastIndexOf("/") + 1);
}

/**
 * A route parameter as text.
 *
 * @param params the parameters a call was made with
 * @param key the parameter's name
 * @returns its value as text, or `?` when the call had none
 */
export function paramOf({ params, key }: { params: GithubExposureParams; key: string }): string {
  const value = params[key];
  if (value === undefined) {
    return "?";
  }
  return String(value);
}
