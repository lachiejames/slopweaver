/**
 * The one decoder for a persisted stream cursor — `{ <position>: <non-negative integer>, recordedAtIso?: string }`.
 *
 * The supervisor stream cursor (`events/cursor.ts`, keyed `offset`) persists this record, and the retired cmux
 * event cursor file (keyed `seq`) is read through it once, when `cmux/eventState/` imports it into the store.
 * Each keeps its own path, its own refusal wording and its own escape hatch; what they share is what counts as a
 * record one of them wrote, which is decided here once.
 */
import { isRecord } from "./parsers.js";
import { err, ok, type Result } from "./result.js";

/**
 * Decode a cursor file's text.
 *
 * An ABSENT instant is fine, since a reader needs only the position. One that is there but not a string is not
 * a record either module wrote.
 *
 * @param text the file's contents
 * @param positionKey the field carrying the position, `offset` or `seq`
 * @returns the position and, when recorded, its instant — or the one detail naming why the record is not believable
 */
export function decodeCursorRecord({
  text,
  positionKey,
}: {
  text: string;
  positionKey: string;
}): Result<{ readonly position: number; readonly recordedAtIso?: string }> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return err(["it is not JSON"]);
  }
  if (!isRecord(decoded)) {
    return err(["it is not an object"]);
  }
  const position = decoded[positionKey];
  if (typeof position !== "number" || !Number.isSafeInteger(position) || position < 0) {
    return err([`its ${positionKey} is not a non-negative integer`]);
  }
  const recordedAtIso = decoded["recordedAtIso"];
  if (recordedAtIso === undefined) {
    return ok({ position });
  }
  if (typeof recordedAtIso !== "string") {
    return err(["its recordedAtIso is not a string"]);
  }
  return ok({ position, recordedAtIso });
}
