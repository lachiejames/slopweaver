/**
 * The canonical JSON a calendar write's approval digest is taken over, so the digest depends on the values a
 * plan holds and never on the order something assembled them in. Pure.
 */
import { isRecord } from "#lib/parsers.js";

/**
 * JSON with every object's keys sorted, so two equal values digest equally whatever built them.
 *
 * @returns canonical JSON for the value
 */
export function canonicalJson({ value }: { value: unknown }): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson({ value: item })).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson({ value: field })}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
