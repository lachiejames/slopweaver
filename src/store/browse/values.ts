/**
 * One stored value turned into the cell a page draws: credentials masked, cut to its display bound, and its full
 * length kept so a cut cell says how much it held.
 *
 * Masking happens HERE, in the CLI, before the value is printed — never in the page, by which time the raw value
 * would already have crossed the process boundary. It reuses the fail-closed masker the console's file views use
 * (`src/talk/fileRedaction.ts`): mask every credential shape and every string on the owner's private denylist, then
 * scan the result again, and withhold the whole cell if anything the gate calls a secret survived.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { redactCredentials, survivingSecrets } from "../../talk/fileRedaction.js";
import { type StoreBrowseError, StoreBrowseErrors } from "./errors.js";
import type { StoreCell } from "./types.js";

/**
 * The cell for one value as Postgres returned it: `value` is the text it rendered (already cut to the fetch window),
 * `length` the stored value's full length in characters.
 *
 * @param value the column's text, or `null` for SQL NULL
 * @param length the full length Postgres measured, `null` exactly when the value is
 * @param denylist the owner's private secret strings, masked wherever they appear
 * @param showCharacters how many characters of the masked text the cell shows before it is cut
 * @returns the cell, or `QUERY_FAILED` when the driver handed back something that is not text and a length
 */
export function storeCellOf({
  value,
  length,
  denylist,
  showCharacters,
}: {
  value: unknown;
  length: unknown;
  denylist: readonly string[];
  showCharacters: number;
}): Result<StoreCell, StoreBrowseError> {
  if (value === null && length === null) {
    return ok({ kind: "null" });
  }
  if (typeof value !== "string" || typeof length !== "number") {
    return err(StoreBrowseErrors.queryFailed({ cause: new Error("a value came back that is not text with a length") }));
  }
  const masked = redactCredentials({ denylist, source: false, text: value }).text;
  const survivors = survivingSecrets({ denylist, text: masked });
  if (survivors.length > 0) {
    return ok({
      kind: "withheld",
      why: `withheld: it holds a credential the mask could not remove (${survivors.join(", ")})`,
    });
  }
  const points = Array.from(masked);
  const cut = points.length > showCharacters;
  let text = masked;
  if (cut) {
    text = points.slice(0, showCharacters).join("");
  }
  return ok({ characters: length, kind: "value", text, truncated: cut || Array.from(value).length < length });
}

/**
 * The `QUERY_FAILED` error for something the database threw, its message put through the same mask as a cell. A
 * database error can quote a stored value — a cast or a policy function raising with the value in its text — so its
 * message is masked before it is printed, and withheld whole when a secret survives the mask.
 *
 * @param cause what the driver or the transaction threw
 * @param denylist the owner's private secret strings, masked wherever they appear
 * @returns the error, its message safe to print
 */
export function maskedQueryFailure({
  cause,
  denylist,
}: {
  cause: unknown;
  denylist: readonly string[];
}): StoreBrowseError {
  let raw = String(cause);
  if (cause instanceof Error) {
    raw = cause.message;
  }
  const masked = redactCredentials({ denylist, source: false, text: raw }).text;
  const survivors = survivingSecrets({ denylist, text: masked });
  if (survivors.length > 0) {
    return StoreBrowseErrors.queryFailed({
      cause: new Error(`the database's message was withheld: it holds a credential the mask could not remove`),
    });
  }
  return StoreBrowseErrors.queryFailed({ cause: new Error(masked) });
}
