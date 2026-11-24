/**
 * The row locator: how a row a page listed is found again for the row panel. Versioned JSON, carried as lowercase
 * hex so it is opaque to the console and safe in an argv. It holds the table's name and the row's physical position
 * (`tableoid`, `ctid`) and writing transaction (`xmin`) — never a value from the row, since hex hides nothing and a
 * key value would print past the credential mask. Decoding checks the SHAPE; the table name is still untrusted and
 * is confirmed against the live catalog before it is used.
 */

import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { nameOfToken, tokenOfName } from "./catalog.js";
import { type StoreBrowseError, StoreBrowseErrors } from "./errors.js";
import type { StoreRowLocator } from "./types.js";

/** The locator format this reader issues and accepts. */
const LOCATOR_VERSION = 1;

/** The longest locator accepted, in hex characters: a position and the longest table name fit well inside it. */
export const MAX_LOCATOR_HEX = 8192;

/**
 * Encode a locator as the hex token a page carries.
 *
 * @returns lowercase hex of the locator's versioned JSON
 */
export function encodeStoreRowLocator({ locator }: { locator: StoreRowLocator }): string {
  return tokenOfName({
    name: safeJsonStringify({ label: "store row locator", value: { ...locator, v: LOCATOR_VERSION } }),
  });
}

/** Whether a value is a plain string-keyed record. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decode a locator token, refusing anything this reader did not issue.
 *
 * @param encoded the hex a request carried
 * @returns the locator, its names not yet confirmed against the catalog, or `LOCATOR_INVALID`
 */
export function decodeStoreRowLocator({ encoded }: { encoded: string }): Result<StoreRowLocator, StoreBrowseError> {
  const invalid = ({ why }: { why: string }): Result<StoreRowLocator, StoreBrowseError> =>
    err(StoreBrowseErrors.locatorInvalid({ why }));
  if (encoded.length > MAX_LOCATOR_HEX) {
    return invalid({ why: `it is over ${String(MAX_LOCATOR_HEX)} hex characters` });
  }
  const text = nameOfToken({ token: encoded });
  if (text.isErr()) {
    return invalid({ why: text.error });
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "store row locator", text: text.value });
  } catch {
    return invalid({ why: "it is not JSON" });
  }
  if (!isRecord(parsed) || parsed["v"] !== LOCATOR_VERSION || typeof parsed["table"] !== "string") {
    return invalid({ why: `it is not a version ${String(LOCATOR_VERSION)} locator naming a table` });
  }
  const table = parsed["table"];
  if (parsed["kind"] !== "ctid-xmin") {
    return invalid({ why: "it does not carry a row position" });
  }
  const { tableoid, ctid, xmin } = parsed;
  if (typeof tableoid !== "string" || typeof ctid !== "string" || typeof xmin !== "string") {
    return invalid({ why: "its tableoid, ctid or xmin is missing" });
  }
  if (!/^\d{1,10}$/.test(tableoid) || !/^\(\d{1,10},\d{1,5}\)$/.test(ctid) || !/^\d{1,10}$/.test(xmin)) {
    return invalid({ why: "its tableoid, ctid or xmin is not one Postgres prints" });
  }
  return ok({ ctid, kind: "ctid-xmin", table, tableoid, xmin });
}
