/**
 * One data line of a `COPY … FROM stdin;` section in PostgreSQL's text format, decoded to its fields. Pure.
 *
 * The format (PostgreSQL docs, "COPY" § File Formats § Text Format): columns are separated by a TAB, a field that
 * is exactly `\N` is SQL null, and inside a field a backslash escapes — `\b \f \n \r \t \v \\`, an octal byte `\ooo`
 * (one to three digits), and a hex byte `\xhh` (one or two digits). Any other backslashed character stands for
 * itself — a literal TAB included, which COPY FROM reads as data rather than as a column break, though pg_dump always
 * writes `\t`. So the line is split on every TAB no backslash quotes, and each field is then unescaped to BYTES, because an octal or hex escape names a byte, not a character; the bytes must then be
 * exactly UTF-8 or the field is refused. A field's bytes are returned beside its text, so a body is hashed as the
 * bytes the dump carried rather than as a re-encoding of them.
 */
import { err, ok, type Result } from "#lib/result.js";

import { decodeExactly } from "../fleet/exactText.js";
import { type CopyLineError, CopyLineErrors } from "./errors.js";

/** One decoded field: SQL null, or its text and the exact bytes it decoded from. */
export type CopyField = null | { readonly text: string; readonly bytes: Buffer };

/** The single-character escapes, as the byte each stands for. */
const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  "\\": 0x5c,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
};

/** How many of `chars` from `start` match `pattern`, up to `max`. */
function runLength({
  chars,
  start,
  pattern,
  max,
}: {
  chars: string;
  start: number;
  pattern: RegExp;
  max: number;
}): number {
  let length = 0;
  while (length < max && start + length < chars.length && pattern.test(chars[start + length]!)) {
    length += 1;
  }
  return length;
}

/**
 * One field's raw characters as the bytes they encode.
 *
 * @param raw the field exactly as it sits between TABs
 * @returns the bytes, or why the field is not COPY text
 */
function unescapeField({ raw }: { raw: string }): Buffer | string {
  const bytes: number[] = [];
  let index = 0;
  while (index < raw.length) {
    if (raw[index] !== "\\") {
      // Copy the character's own UTF-8 bytes; a surrogate pair is one code point, so step by its length.
      const literal = String.fromCodePoint(raw.codePointAt(index)!);
      bytes.push(...Buffer.from(literal, "utf8"));
      index += literal.length;
      continue;
    }
    const escape = decodeEscape({ index, raw });
    if (typeof escape === "string") {
      return escape;
    }
    if (escape.byte !== undefined) {
      bytes.push(escape.byte);
    }
    index += escape.width;
  }
  return Buffer.from(bytes);
}

/**
 * The backslash escape starting at `index`.
 *
 * @param raw the field exactly as it sits between TABs
 * @param index where its backslash is
 * @returns the byte it stands for — none when the character after it stands for itself, read on the next step — and
 *   how many characters to step past; or why it is not COPY text
 */
function decodeEscape({ raw, index }: { raw: string; index: number }): { byte?: number; width: number } | string {
  const next = raw[index + 1];
  if (next === undefined) {
    return "it ends in a lone backslash";
  }
  const simple = SIMPLE_ESCAPES[next];
  if (simple !== undefined) {
    return { byte: simple, width: 2 };
  }
  const octal = runLength({ chars: raw, max: 3, pattern: /[0-7]/u, start: index + 1 });
  if (octal > 0) {
    return { byte: Number.parseInt(raw.slice(index + 1, index + 1 + octal), 8) & 0xff, width: 1 + octal };
  }
  const hex = next === "x" ? runLength({ chars: raw, max: 2, pattern: /[0-9a-fA-F]/u, start: index + 2 }) : 0;
  if (hex > 0) {
    return { byte: Number.parseInt(raw.slice(index + 2, index + 2 + hex), 16), width: 2 + hex };
  }
  // Any other backslashed character stands for itself.
  return { width: 1 };
}

/**
 * A line's fields, still escaped, split on every TAB that no backslash quotes.
 *
 * @param line the data line
 * @returns each field's raw characters
 */
function splitUnescapedTabs({ line }: { line: string }): string[] {
  const raws: string[] = [];
  let start = 0;
  let index = 0;
  while (index < line.length) {
    if (line[index] === "\\") {
      // The backslash and whatever it quotes stay in the field together, a literal TAB included.
      index += 2;
      continue;
    }
    if (line[index] === "\t") {
      raws.push(line.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  raws.push(line.slice(start));
  return raws;
}

/**
 * Decode one COPY text-format data line.
 *
 * @param line the line, without its newline
 * @param columns how many columns the section declared
 * @returns each field, or why the line is not exactly a row of that many columns
 */
export function decodeCopyLine({
  line,
  columns,
}: {
  line: string;
  columns: number;
}): Result<CopyField[], CopyLineError> {
  // A line that is exactly `\.` is COPY's end-of-data marker, read before any field is split: it stores no row, so
  // decoding it as a `.` would return a field PostgreSQL never holds.
  if (line === "\\.") {
    return err(CopyLineErrors.endMarker());
  }
  // A lone surrogate has no UTF-8 bytes, and encoding it would quietly write U+FFFD instead.
  if (!line.isWellFormed()) {
    return err(CopyLineErrors.loneSurrogate());
  }
  const raws = splitUnescapedTabs({ line });
  if (raws.length !== columns) {
    return err(CopyLineErrors.fieldCount({ declared: columns, found: raws.length }));
  }
  const fields: CopyField[] = [];
  for (const [position, raw] of raws.entries()) {
    if (raw === "\\N") {
      fields.push(null);
      continue;
    }
    const bytes = unescapeField({ raw });
    const field = position + 1;
    if (typeof bytes === "string") {
      return err(CopyLineErrors.badEscape({ field, reason: bytes }));
    }
    if (bytes.includes(0x00)) {
      return err(CopyLineErrors.nulByte({ field }));
    }
    const text = decodeExactly({ bytes });
    if (text === undefined) {
      return err(CopyLineErrors.notUtf8({ field }));
    }
    fields.push({ bytes, text });
  }
  return ok(fields);
}
