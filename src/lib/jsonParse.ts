/**
 * Tolerant JSON parsing — the `try { JSON.parse } catch { … }` shape reimplemented in the corpus store,
 * vector cache, watermark/thread-cursor readers, identity store, and the LLM envelope extractor. Each
 * returns a typed {@link Result} of the raw parsed value (or a {@link JsonParseError}); the DOMAIN
 * validation of that value stays at the call-site (it's source-specific and never belongs in a generic
 * helper). Pure.
 */

import { isRecord } from "./parsers.js";
import { err, ok, type Result } from "./result.js";

/**
 * Why a text did not parse — this module's own union, never one another domain adopts. Each variant's whole
 * content is its sentence, so a caller displays `message` and branches on `code`.
 */
export type JsonParseError =
  | { readonly code: "INVALID_JSON"; readonly message: string }
  | { readonly code: "NOT_JSON_OBJECT"; readonly message: string }
  | { readonly code: "EMPTY_LINE"; readonly message: string };

/** How to raise one — the factory the parsers below call, so a test built the same way catches a drift. */
export const JsonParseErrors = {
  emptyLine: (): JsonParseError => ({ code: "EMPTY_LINE", message: "empty line" }),
  invalidJson: (): JsonParseError => ({ code: "INVALID_JSON", message: "invalid JSON" }),
  notJsonObject: (): JsonParseError => ({ code: "NOT_JSON_OBJECT", message: "not a JSON object" }),
} as const;

/**
 * Parse JSON text into an unknown value, mapping a `SyntaxError` to a typed error rather than a throw. Pure.
 *
 * @param text the JSON text
 * @returns the parsed value, or `INVALID_JSON`
 */
export function parseJson({ text }: { text: string }): Result<unknown, JsonParseError> {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err(JsonParseErrors.invalidJson());
  }
}

/**
 * Parse JSON text that must be an object (not an array or primitive). Pure — the shape beyond "is an
 * object" is the caller's to validate.
 *
 * @param text the JSON text
 * @returns the parsed object, `INVALID_JSON`, or `NOT_JSON_OBJECT`
 */
export function parseJsonObject({ text }: { text: string }): Result<Record<string, unknown>, JsonParseError> {
  return parseJson({ text }).andThen((value) => (isRecord(value) ? ok(value) : err(JsonParseErrors.notJsonObject())));
}

/**
 * Parse one NDJSON line — a blank/whitespace-only line is a typed error (never a throw), otherwise it
 * defers to {@link parseJson}. Pure.
 *
 * @param line the raw line
 * @returns the parsed value, `EMPTY_LINE`, or `INVALID_JSON`
 */
export function parseJsonLine({ line }: { line: string }): Result<unknown, JsonParseError> {
  if (line.trim().length === 0) {
    return err(JsonParseErrors.emptyLine());
  }
  return parseJson({ text: line });
}

/**
 * Parse an append-only JSONL log's raw text into typed entries, tolerant of a blank or malformed line — a
 * corrupt line must not make the whole log unreadable, but a skipped line is a lost fact worth reporting
 * rather than silently dropping. The shared shell several append-only registries in this repo build their
 * own `parseXLog` around (`live/ask/ignore.ts`, `live/ask/ignoredConversation.ts`, …), so the tolerant loop
 * over blank/malformed/shape-mismatched lines exists in exactly one place. Pure.
 *
 * @param text the raw log contents
 * @param ofValue decode one parsed JSON object into an entry, or `undefined` when its shape does not match
 * @returns the parsed entries and the 1-indexed line numbers that could not be read
 */
export function parseTolerantJsonlLog<T>({
  text,
  ofValue,
}: {
  text: string;
  ofValue: (input: { value: Record<string, unknown> }) => T | undefined;
}): { readonly entries: readonly T[]; readonly unreadable: readonly number[] } {
  const entries: T[] = [];
  const unreadable: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    const parsed = parseJsonObject({ text: line });
    if (parsed.isErr()) {
      unreadable.push(index + 1);
      return;
    }
    const entry = ofValue({ value: parsed.value });
    if (entry === undefined) {
      unreadable.push(index + 1);
      return;
    }
    entries.push(entry);
  });
  return { entries, unreadable };
}
