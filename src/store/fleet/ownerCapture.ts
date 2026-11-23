/**
 * What every captured-turn projection shares: a body checked to be storable exactly as the owner said it, and its hash.
 *
 * Pure. The two source projections (`./superwhisperCapture.ts`, `./codexMessageCapture.ts`) each read their own
 * record shape and hand the body here; the table header (`../schema/ownerCapture.ts`) says why the row is keyed by
 * its source's own id and why `said_at` is never a file time.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";

/** A body ready for the table: the text verbatim, its UTF-8 size and its sha-256. */
export interface CaptureBody {
  readonly body: string;
  readonly byteLength: number;
  readonly bodySha256: string;
}

/**
 * Why a string a capture stores cannot be written to Postgres byte for byte, or `undefined` when it can.
 *
 * Every stored string is held to it, the body and each id and label beside it, so the refusal names the record
 * rather than surfacing later as one write failure for the whole leg. A NUL is
 * refused because a Postgres `text` column cannot carry one. A lone surrogate (a JSON `\ud800` escape decodes to
 * one) has no UTF-8 encoding, so `Buffer.from` would store U+FFFD in its place.
 *
 * @param text the string exactly as the source recorded it
 * @param field what the string is, named in the reason
 * @returns the reason, or `undefined` when it is storable
 */
export function unstorableTextReason({ text, field }: { text: string; field: string }): string | undefined {
  if (text.includes("\u0000")) {
    return `its ${field} contains a NUL, which a Postgres text column cannot hold`;
  }
  if (!text.isWellFormed()) {
    return `its ${field} contains a lone surrogate, which has no UTF-8 encoding`;
  }
  return undefined;
}

/**
 * Check a captured body can be stored verbatim and measure it.
 *
 * A NUL is refused because a Postgres `text` column cannot carry one; an empty body is refused because a
 * capture of nothing is not a turn (a caller that expects empties — Superwhisper's silent recordings — skips
 * them before calling this).
 *
 * @param body the text exactly as the source recorded it
 * @param path the record, named in a refusal
 * @returns the body with its size and hash, or the refusal
 */
export function captureBody({ body, path }: { body: string; path: string }): Result<CaptureBody, FleetImportError> {
  if (body.length === 0) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path, reason: "its text is empty" }));
  }
  const unstorable = unstorableTextReason({ field: "text", text: body });
  if (unstorable !== undefined) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path, reason: unstorable }));
  }
  const bytes = Buffer.from(body, "utf8");
  return ok({ body, bodySha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length });
}

/**
 * A record's field as a string, when it is one.
 *
 * @param record the decoded record
 * @param key the field
 * @returns the string, or `undefined` when the field is absent or not a string
 */
export function stringField({ record, key }: { record: Record<string, unknown>; key: string }): string | undefined {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * Whether a decoded JSON value is a plain object.
 *
 * @param value the decoded value
 * @returns whether it is an object and not an array or null
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
