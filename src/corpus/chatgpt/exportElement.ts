/**
 * One conversations-file element read to a value, refusing what `JSON.parse` would read without a word: an object
 * spelling one key twice, where only the last value survives — `{"n":{…a message…},"n":null}` would otherwise read as
 * a chat that never held that message. Both readers of an element (the merge's weighing and the ingest) come here, so
 * neither can see a value the other refused.
 */
import { findDuplicateKey } from "#lib/jsonDuplicateKey.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

/** A conversations-file element that is not JSON. */
export interface ElementNotJsonError {
  readonly code: "ELEMENT_NOT_JSON";
  readonly message: string;
  /** Always empty: an element that will not parse names no conversation. */
  readonly ids: readonly string[];
}

/** An element spelling one key twice in one object, which a JSON reader reads as the last value alone. */
export interface ElementDuplicateKeyError {
  readonly code: "ELEMENT_DUPLICATE_KEY";
  readonly message: string;
  /** The repeated key's path, outermost first. */
  readonly path: readonly string[];
  /** The conversation ids it names; none when the repeated key is an id. */
  readonly ids: readonly string[];
}

/** Every way one conversations-file element fails to read as a value. */
export type ChatgptElementError = ElementNotJsonError | ElementDuplicateKeyError;

export const ChatgptElementErrors = {
  duplicateKey: ({ path, ids }: { path: readonly string[]; ids: readonly string[] }): ElementDuplicateKeyError => ({
    code: "ELEMENT_DUPLICATE_KEY",
    ids,
    message: `holds the key ${path.join(".")} twice in one object, and JSON keeps only the last, so what the first held would be lost unseen`,
    path,
  }),
  notJson: ({ cause }: { cause: unknown }): ElementNotJsonError => ({
    code: "ELEMENT_NOT_JSON",
    ids: [],
    message: `is not JSON it can read (${String(cause)})`,
  }),
} as const;

/** The top-level fields a conversation is identified by, in the order a gap names them. */
const ID_FIELDS = ["id", "conversation_id"] as const;

/**
 * Every conversation id an element names at its top level, `id` first — unchecked, since it reads an element the
 * schema may refuse. Empty when it names none.
 *
 * @param value one parsed element
 * @returns the ids it names
 */
export function elementIds({ value }: { value: unknown }): readonly string[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const ids: string[] = [];
  for (const field of ID_FIELDS) {
    const named: unknown = Object.getOwnPropertyDescriptor(value, field)?.value;
    if (typeof named === "string") {
      ids.push(named);
    }
  }
  return ids;
}

/**
 * One element as a value, or why it is not one this reader can trust.
 *
 * @param text the element's JSON text
 * @param label what the element is, for the size guard's warning
 * @returns the value, or the refusal — carrying the ids it names, none when a repeated key is the id itself
 */
export function readExportElement({
  text,
  label,
}: {
  text: string;
  label: string;
}): Result<unknown, ChatgptElementError> {
  let value: unknown;
  try {
    value = safeJsonParse({ label, text });
  } catch (cause) {
    return err(ChatgptElementErrors.notJson({ cause }));
  }
  const repeated = findDuplicateKey({ text });
  if (repeated !== undefined) {
    const repeatsAnId = repeated.length === 1 && ID_FIELDS.some((field) => field === repeated[0]);
    const ids = repeatsAnId ? [] : elementIds({ value });
    return err(ChatgptElementErrors.duplicateKey({ ids, path: repeated }));
  }
  return ok(value);
}
