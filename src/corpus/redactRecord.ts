/**
 * Record-level redaction: the first step of the bronze write pipeline (`corpusWriter.ts`), run so no secret
 * ever touches disk. It applies `redact.ts`'s text passes to a record's `text`, `title`, string `attrs` and
 * every string leaf of `raw`, and the token and email passes to an `author` that is not its source's
 * native-id shape ({@link redactAuthor} says why the digit pass is skipped there); `sourceId`, `url`,
 * `container` and `refs` are structural and pass through.
 */
import { isRecord } from "../lib/parsers.js";
import { isNativeIdShaped } from "../silver/nativeIdShape.js";
import { redactAuthor, redactText } from "./redact.js";
import type { CorpusAttributeValue, CorpusRecord } from "./types.js";

/**
 * A record's author with any address or token scrubbed — unless it is the source's own native-id shape, which
 * passes byte for byte. The exemption is not a courtesy: a GitHub login may legally read `sk-` and twenty
 * alphanumerics, which the token pass matches, and that login is the key the identity roster joins on.
 */
function scrubAuthor({ record, author }: { record: CorpusRecord; author: string }): string {
  if (record.source !== "gold" && isNativeIdShaped({ source: record.source, value: author })) {
    return author;
  }
  return redactAuthor({ text: author }).text;
}

/** Redact string + string-array attr values (a secret can hide in metadata too); scalars pass through. */
function redactAttrs({
  attrs,
}: {
  attrs: Readonly<Record<string, CorpusAttributeValue>>;
}): Record<string, CorpusAttributeValue> {
  const out: Record<string, CorpusAttributeValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "string") {
      out[key] = redactText({ text: value }).text;
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => redactText({ text: item }).text);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Recursively redact every string LEAF of a raw JSON value, preserving structure + all keys. A secret can
 * hide anywhere in the raw payload, so we scrub string substrings (email/token shapes) everywhere while
 * keeping every field — the whole point of raw retention. Non-strings (numbers/booleans/null) pass through.
 *
 * @param value any JSON value from a raw payload
 * @returns the same-shaped value with string leaves redacted
 */
function redactRawValue({ value }: { value: unknown }): unknown {
  if (typeof value === "string") {
    return redactText({ text: value }).text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactRawValue({ value: item }));
  }
  if (isRecord(value)) {
    return redactRawObject({ obj: value });
  }
  return value;
}

/** Redact every string leaf of a raw JSON OBJECT, returning the same-keyed object (typed, no cast at use). */
function redactRawObject({ obj }: { obj: Readonly<Record<string, unknown>> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(obj)) {
    out[key] = redactRawValue({ value: inner });
  }
  return out;
}

/**
 * Redact a record's free text (and title + string attrs + the raw payload), and any address or token in its
 * author; refs are structural, left intact.
 *
 * @param record the record to redact
 * @returns a new record with scrubbed text/title/attrs/raw/author
 */
export function redactRecord({ record }: { record: CorpusRecord }): CorpusRecord {
  return {
    ...record,
    text: redactText({ text: record.text }).text,
    ...(record.author !== undefined ? { author: scrubAuthor({ author: record.author, record }) } : {}),
    ...(record.title !== undefined ? { title: redactText({ text: record.title }).text } : {}),
    ...(record.attrs !== undefined ? { attrs: redactAttrs({ attrs: record.attrs }) } : {}),
    ...(record.raw !== undefined ? { raw: redactRawObject({ obj: record.raw }) } : {}),
  };
}
