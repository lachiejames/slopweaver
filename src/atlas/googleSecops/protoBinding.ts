/**
 * Reading an rpc's `option (google.api.http) = { ... }` value and deciding the one REST binding it names.
 *
 * Adjacent string literals concatenate, as protobuf's text format says, so a path wrapped across two lines
 * reads as one. Every rpc must carry EXACTLY ONE `get`/`post`/`patch`/`put`/`delete` binding: two, a
 * `custom` verb, or `additional_bindings` is `HTTP_BINDING_AMBIGUOUS`, because an rpc reachable on two
 * paths is two rows this reader has no rule to name, and a key this reader does not know is refused rather
 * than skipped.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  type GoogleSecopsInventoryError,
  GoogleSecopsInventoryErrors,
  type GoogleSecopsProtoSyntaxError,
  GoogleSecopsProtoSyntaxErrors,
} from "./errors.js";
import type { ProtoCursor } from "./protoLex.js";
import type { GoogleSecopsHttpMethod } from "./surfaceRow.js";

/** One `key: value` entry of the http option's aggregate value. */
export interface BindingEntry {
  readonly key: string;
  /** The concatenated string value, or `null` for a nested block. */
  readonly value: string | null;
}

/** The single REST binding an rpc declares. */
export interface PlacedBinding {
  readonly httpMethod: GoogleSecopsHttpMethod;
  readonly pathTemplate: string;
}

/** The binding keys that name a REST verb, mapped to the method each one means. */
const VERB_KEYS: ReadonlyMap<string, GoogleSecopsHttpMethod> = new Map([
  ["delete", "DELETE"],
  ["get", "GET"],
  ["patch", "PATCH"],
  ["post", "POST"],
  ["put", "PUT"],
]);

/** Binding keys that are read and carry nothing a row needs. */
const INERT_BINDING_KEYS: ReadonlySet<string> = new Set(["body", "response_body"]);

/** Binding keys that make the rpc's REST shape something other than one verb on one path. */
const AMBIGUOUS_BINDING_KEYS: ReadonlySet<string> = new Set(["additional_bindings", "custom"]);

/**
 * Consume every adjacent string literal under the cursor.
 *
 * @param cursor the token cursor
 * @returns the decoded strings, empty when none sits there
 */
function readStrings({ cursor }: { cursor: ProtoCursor }): readonly string[] {
  const strings: string[] = [];
  while (cursor.peek()?.kind === "string") {
    strings.push(cursor.next()!.value);
  }
  return strings;
}

/**
 * Read one `key: value` or `key { ... }` entry.
 *
 * @param cursor the token cursor, sitting on the key
 * @returns the entry, a nested block reported with a `null` value
 */
function readEntry({ cursor }: { cursor: ProtoCursor }): Result<BindingEntry, GoogleSecopsProtoSyntaxError> {
  const key = cursor.ident();
  if (key.isErr()) {
    return err(key.error);
  }
  if (cursor.is({ value: ":" })) {
    cursor.next();
  }
  return readBindingValue({ cursor, key: key.value });
}

/**
 * Read the value of one binding key: a nested block, or one or more adjacent strings.
 *
 * @param cursor the token cursor, sitting on the value
 * @param key the key the value belongs to
 * @returns the entry, a nested block reported with a `null` value
 */
function readBindingValue({
  cursor,
  key,
}: {
  cursor: ProtoCursor;
  key: string;
}): Result<BindingEntry, GoogleSecopsProtoSyntaxError> {
  if (cursor.is({ value: "{" })) {
    return readHttpAggregate({ cursor }).map(() => ({ key, value: null }));
  }
  const strings = readStrings({ cursor });
  if (strings.length === 0) {
    return err(
      GoogleSecopsProtoSyntaxErrors.bindingMalformed({ detail: `binding key '${key}' carries no string value` }),
    );
  }
  return ok({ key, value: strings.join("") });
}

/**
 * Read the value of a sub-field form of the http option, `option (google.api.http).<path> = <value>;`, the
 * cursor sitting just past the `=`.
 *
 * Protobuf merges this form into the same `HttpRule` as the aggregate form, so it is read as one more entry
 * of that rule rather than skipped as some other option — skipping it is how an `additional_bindings`
 * written this way would slip past the ambiguity refusal. A path deeper than one field
 * (`additional_bindings.get`) is an entry for its FIRST field with no string value: that field is a nested
 * message, never a verb's path.
 *
 * @param cursor the token cursor
 * @param path everything after `(google.api.http).`
 * @returns the one entry it contributes
 */
export function readHttpSubField({
  cursor,
  path,
}: {
  cursor: ProtoCursor;
  path: string;
}): Result<BindingEntry, GoogleSecopsProtoSyntaxError> {
  const dot = path.indexOf(".");
  if (dot === -1) {
    return readBindingValue({ cursor, key: path });
  }
  const key = path.slice(0, dot);
  return readBindingValue({ cursor, key }).map(() => ({ key, value: null }));
}

/**
 * Read a text-format aggregate `{ key: value ... }`, the cursor sitting on its `{`.
 *
 * @param cursor the token cursor
 * @returns every top-level entry, nested blocks reported with a `null` value
 */
export function readHttpAggregate({
  cursor,
}: {
  cursor: ProtoCursor;
}): Result<readonly BindingEntry[], GoogleSecopsProtoSyntaxError> {
  const opened = cursor.expect({ value: "{" });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const entries: BindingEntry[] = [];
  while (!cursor.is({ value: "}" })) {
    const entry = readEntry({ cursor });
    if (entry.isErr()) {
      return err(entry.error);
    }
    entries.push(entry.value);
    if (cursor.is({ value: "," }) || cursor.is({ value: ";" })) {
      cursor.next();
    }
  }
  return cursor.expect({ value: "}" }).map(() => entries);
}

/**
 * Decide the one REST binding an rpc's http option declares.
 *
 * @param entries the http option's entries
 * @param document the pinned file, for the error
 * @param method the fully qualified method, for the error
 * @returns the verb and path, or why the binding is not exactly one placeable verb
 */
export function httpBindingOf({
  entries,
  document,
  method,
}: {
  entries: readonly BindingEntry[];
  document: string;
  method: string;
}): Result<PlacedBinding, GoogleSecopsInventoryError> {
  const ambiguous = entries.find((entry) => AMBIGUOUS_BINDING_KEYS.has(entry.key));
  if (ambiguous !== undefined) {
    const detail = `declares ${ambiguous.key}`;
    return err(GoogleSecopsInventoryErrors.httpBindingAmbiguous({ detail, document, method }));
  }
  const placed = entries.filter((entry) => !INERT_BINDING_KEYS.has(entry.key));
  const unknown = placed.find((entry) => !VERB_KEYS.has(entry.key) || entry.value === null);
  if (unknown !== undefined) {
    const detail = `${method}: unknown binding key '${unknown.key}'`;
    return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document }));
  }
  // Both non-null assertions are the `find` just above: every entry left names a known verb and a string.
  const verbs = placed.map((entry) => ({ httpMethod: VERB_KEYS.get(entry.key)!, pathTemplate: entry.value! }));
  const only = verbs[0];
  if (only === undefined || verbs.length > 1) {
    const detail = `the binding names ${String(verbs.length)} verbs`;
    return err(GoogleSecopsInventoryErrors.httpBindingAmbiguous({ detail, document, method }));
  }
  return ok(only);
}
