/**
 * The reader vocabulary every API projection parses through: the raw-unknown half of this atlas's second
 * read-only boundary.
 *
 * `inventory.ts` closes which calls may be made. {@link readField} decides which of a response's FIELDS
 * become a record, consulting `privacy.ts` before it consults the value, and every accessor in this file
 * goes through it — so a denied field cannot be reached by reading it "just this once" in one projection.
 * `entities.ts` then refuses anything that got past both, because every schema there is `.strict()`. Three
 * independent mechanisms, so no single mistake stores a field nobody reviewed.
 *
 * ## Nothing here trusts a shape
 *
 * Every accessor takes `unknown` and returns `null` rather than throwing. A provider that renames
 * `device_id` produces a named refusal upstream, not a record with an empty id — which is the failure that
 * puts a plausible-looking lie on disk and stales a real machine on the next run.
 *
 * ## Timestamps are normalised, never scaled
 *
 * Falcon returns ISO-8601 strings on every field this atlas stores, so {@link readIso} re-renders them
 * through `Date` to get one canonical spelling and refuses anything unparseable. No epoch arithmetic
 * happens here at all — see the `epoch-arithmetic` gate in `yarn lint` for why that matters.
 *
 * ## A substitution is named, never an operator
 *
 * {@link readStringOr} and {@link readBooleanOr} carry a placeholder into a record and say so in their own
 * name; {@link firstOf} answers the first of several spellings of one fact and stays nullable when none
 * read. The two are different acts and the names keep them apart at the call site (the owner's ruling).
 */

import { isDeniedCrowdstrikeField } from "./privacy.js";

/**
 * Is this an object we can read properties from?
 *
 * @returns true when the value is a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read one provider field, refusing anything `privacy.ts` denies.
 *
 * The single choke point every accessor below goes through, so a denied field cannot be reached by reading
 * it "just this once" in one projection. A denied field reads as absent, which is what it is as far as this
 * atlas is concerned.
 *
 * @param raw the provider object
 * @param field the provider's own field name
 * @returns the value, or `null` when absent or denied
 *
 * @internal
 */
export function readField({ raw, field }: { raw: unknown; field: string }): unknown {
  if (!isRecord(raw) || isDeniedCrowdstrikeField({ field })) {
    return null;
  }
  const value = raw[field];
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * Read a provider field as a non-empty string.
 *
 * @param raw the provider object
 * @param field the provider's own field name
 * @returns the trimmed string, or `null` when absent, denied, empty or not a string
 */
export function readString({ raw, field }: { raw: unknown; field: string }): string | null {
  const value = readField({ field, raw });
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Read a provider field as a finite number.
 *
 * @param raw the provider object
 * @param field the provider's own field name
 * @returns the number, or `null` when absent, denied or not finite
 */
export function readNumber({ raw, field }: { raw: unknown; field: string }): number | null {
  const value = readField({ field, raw });
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Read a provider field as a boolean.
 *
 * @param raw the provider object
 * @param field the provider's own field name
 * @returns the boolean, or `null` when absent, denied or not a boolean
 *
 * @internal
 */
export function readBoolean({ raw, field }: { raw: unknown; field: string }): boolean | null {
  const value = readField({ field, raw });
  return typeof value === "boolean" ? value : null;
}

/**
 * Read a provider field as a canonical ISO instant.
 *
 * @param raw the provider object
 * @param field the provider's own field name
 * @returns the ISO-8601 instant, or `null` when absent, denied or unparseable
 */
export function readIso({ raw, field }: { raw: unknown; field: string }): string | null {
  const value = readString({ field, raw });
  if (value === null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Read a provider field as a list of non-empty strings.
 *
 * @param raw the provider object
 * @param field the provider's own field name
 * @returns the strings, deduplicated and sorted; empty when absent, denied or not an array
 */
export function readStringArray({ raw, field }: { raw: unknown; field: string }): readonly string[] {
  const value = readField({ field, raw });
  if (!Array.isArray(value)) {
    return [];
  }
  const kept = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return [...new Set(kept.map((entry) => entry.trim()))].toSorted();
}

/**
 * Read a nested object field, so a projection can descend without repeating the guard.
 *
 * @returns the nested object, or `null` when the field is absent, denied or not an object
 */
export function readObject({ raw, field }: { raw: unknown; field: string }): unknown {
  const value = readField({ field, raw });
  return isRecord(value) ? value : null;
}

/**
 * Read a provider field as a non-empty string, substituting a stated value when it does not read.
 *
 * The substitution is NAMED here rather than spelled `??` at the call site, so a record carrying a
 * placeholder is distinguishable from one carrying the provider's own answer by reading the call.
 *
 * @param field the provider's own field name
 * @param substitute what the record carries when the field is absent, denied, empty or not a string
 * @returns the trimmed string, or the substitute
 */
export function readStringOr({ raw, field, substitute }: { raw: unknown; field: string; substitute: string }): string {
  const value = readString({ field, raw });
  if (value === null) {
    return substitute;
  }
  return value;
}

/**
 * Read a provider field as a boolean, substituting a stated value when it does not read.
 *
 * @param field the provider's own field name
 * @param substitute what the record carries when the field is absent, denied or not a boolean
 * @returns the boolean, or the substitute
 */
export function readBooleanOr({
  raw,
  field,
  substitute,
}: {
  raw: unknown;
  field: string;
  substitute: boolean;
}): boolean {
  const value = readBoolean({ field, raw });
  if (value === null) {
    return substitute;
  }
  return value;
}

/**
 * The first attempt that read, out of several spellings of one fact.
 *
 * A fallback between READS, never a default: every element is already `string | null`, so the answer
 * stays nullable when no attempt read, and a caller cannot mistake this for the substitution
 * {@link readStringOr} makes. Falcon spells one fact two ways on several entities — a detection's host
 * is `agent_id` at the top level and `device_id` inside `device`, a login is `user_name` on the most
 * recent entry and `last_login_user` on the host. Every accessor here is pure and reads one field, so
 * evaluating each attempt costs the read and nothing else.
 *
 * @param values each attempt's result, most authoritative first
 * @returns the first non-null value, or `null` when no attempt read
 */
export function firstOf({ values }: { values: readonly (string | null)[] }): string | null {
  for (const value of values) {
    if (value !== null) {
      return value;
    }
  }
  return null;
}
