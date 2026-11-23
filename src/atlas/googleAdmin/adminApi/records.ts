/**
 * Turning one Admin API response into the records the atlas stores — the whole judgement, none of the I/O.
 *
 * ## Why the collection is not assumed to be a collection
 *
 * `plan.ts` proves that every planned method's envelope leaves exactly one payload field, and stops there
 * on purpose: whether that field holds an ARRAY is a property of the RESPONSE, not of the declaration.
 * Two planned methods are aggregates rather than collections — `countChromeOsDevices` answers a `count`
 * and `groups.lookup` answers a `name` — so a reader that assumed an array would either crash on them or,
 * worse, quietly store nothing and report a filled kind. Both are answered here by returning no records
 * and saying so, which is what lets the coverage cell distinguish "read it, it holds none" from "read
 * something that is not a collection at all".
 *
 * ## What is kept, and what is deliberately not
 *
 * A record reduces to its key and its field NAMES. `entityDetail.ts`'s `googleAdminLiveRecordDetailSchema` carries
 * the reasoning, and doing the reduction HERE rather than at the store means no artifact this fill writes —
 * the observation included — ever holds a value.
 *
 * ## The provider key is Google's own, and its absence is a refusal rather than an invented id
 *
 * `model.ts` says the provider key for a live record is "Google's own resource name", and the five fields
 * below are the ways these eleven documents spell one. A record carrying none of them is DROPPED with a
 * reason rather than given a synthesised key: an id this repository invented would be stable only within
 * one run, so the next fill would store the same record again under a different name and the atlas would
 * grow duplicates that look like change.
 *
 * Pure: no I/O, no clock.
 */
import type { GoogleAdminFilledRecord } from "./observation.js";

/**
 * The fields these documents use as a record's own key, in the order they are preferred.
 *
 * `name` first because it is the resource name in every Google API published after the Directory one, and
 * `id` next because that is what the Directory API itself uses. `primaryEmail` and `orgUnitPath` are the
 * two Directory resources whose key is neither, and `schemaName` is the user-schema resource's.
 */
const PROVIDER_KEY_FIELDS: readonly string[] = ["name", "id", "primaryEmail", "orgUnitPath", "schemaName"];

/** What one response's payload field turned out to hold. */
export type GoogleAdminPayloadShape = "records" | "aggregate" | "absent";

/** The records one response yielded, and what its payload field actually was. */
export interface GoogleAdminRecordProjection {
  readonly shape: GoogleAdminPayloadShape;
  readonly records: readonly GoogleAdminFilledRecord[];
  /** Records dropped for carrying no key Google publishes, so a count never silently shrinks. */
  readonly unkeyed: number;
}

/** Narrow an unknown value to a plain object, which is what a record has to be to carry fields. */
function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The key Google published for one record.
 *
 * @param fields the record as Google returned it
 * @returns the first key field it carries as a non-empty string, or `null` when it carries none
 */
export function googleAdminProviderKey({ fields }: { fields: Record<string, unknown> }): string | null {
  for (const field of PROVIDER_KEY_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Project one response's payload field into stored records.
 *
 * @param body the parsed response body
 * @param collectionField the one payload field `plan.ts` derived for this method
 * @returns what the field held, the records it yielded, and how many carried no key
 */
export function googleAdminProjectRecords({
  body,
  collectionField,
}: {
  body: unknown;
  collectionField: string;
}): GoogleAdminRecordProjection {
  if (!isRecordObject(body)) {
    return { records: [], shape: "absent", unkeyed: 0 };
  }
  const payload = body[collectionField];
  if (payload === undefined || payload === null) {
    // Google omits an empty collection rather than returning `[]`, so this is the ordinary "none of these
    // exist" answer as well as the genuinely-missing one. Both are `absent`, and neither is a failure.
    return { records: [], shape: "absent", unkeyed: 0 };
  }
  if (!Array.isArray(payload)) {
    return { records: [], shape: "aggregate", unkeyed: 0 };
  }
  const records: GoogleAdminFilledRecord[] = [];
  let unkeyed = 0;
  for (const item of payload) {
    if (!isRecordObject(item)) {
      unkeyed += 1;
      continue;
    }
    const providerId = googleAdminProviderKey({ fields: item });
    if (providerId === null) {
      unkeyed += 1;
      continue;
    }
    records.push({ fields: Object.keys(item).toSorted(), providerId });
  }
  return {
    records: records.toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
    shape: "records",
    unkeyed,
  };
}

/**
 * The page token a response carries, if it carries one.
 *
 * @param body the parsed response body
 * @returns the token to ask for the next page, or `null` when this was the last one
 */
export function googleAdminNextPageToken({ body }: { body: unknown }): string | null {
  if (!isRecordObject(body)) {
    return null;
  }
  const token = body["nextPageToken"];
  return typeof token === "string" && token.length > 0 ? token : null;
}
