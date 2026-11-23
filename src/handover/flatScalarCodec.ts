/**
 * The ONE codec for a flat front-matter scalar: what `handover register` writes after `key: `, and what the flat
 * reader (`./docFlat.ts`) gives back — the same function pair, so a value read is the value written.
 *
 * Until this module the two halves lived apart and disagreed. The writer JSON-escaped a multi-line or
 * quote-leading value, and the reader decoded only `\"` and `\\`, so a written newline or tab read back as the two
 * visible characters `\n` / `\t`. Neither side was wrong by its own lights; nothing held them to one escape set.
 *
 * The escape set is exactly `JSON.stringify`'s: `\" \\ \/ \b \f \n \r \t \uXXXX`. It is decoded in ONE left-to-right
 * pass, because a sequence of `replaceAll`s cannot tell the escaped backslash in `\\n` from the start of a `\n`.
 * An escape outside the set is kept VERBATIM — a hand-written `"C:\path"` reads as it always has — which is why
 * this is not `JSON.parse`: a hand-edited doc's double-quoted value can be invalid JSON (an unescaped inner `"`),
 * and the reader must still return its text rather than throw or substitute something.
 *
 * One value is outside the round trip by design: the EMPTY string, which `flatValue` reads as the key being absent,
 * quoted or not — a field written empty means unset, as it did before this codec.
 *
 * Pure: strings in, strings out.
 */

/** Every escape `JSON.stringify` writes, as the character it stands for — the `u` form is decoded separately. */
const SHORT_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["\\", "\\"],
  ["/", "/"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
]);

/**
 * U+0085 NEXT LINE, U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR, each with the escape the encoder writes
 * for it. `JSON.stringify` leaves all three raw, and Unicode counts each as a line break.
 * Built from code points so this source file carries none of them.
 */
const UNICODE_SEPARATORS: readonly (readonly [string, string])[] = [
  [String.fromCharCode(0x85), "\\u0085"],
  [String.fromCharCode(0x2028), "\\u2028"],
  [String.fromCharCode(0x2029), "\\u2029"],
];

/**
 * Whether a key's own text is a lone `>`/`|` block indicator, with either chomping indicator — the announcement of a
 * block scalar rather than any of its value.
 *
 * Here beside the codec because the encoder must not write a value that spells one bare: the reader would take it
 * as an instruction about the scalar and lose the value.
 *
 * @param own the text after the key's colon, trimmed
 * @returns true when the lines below are the block's text
 */
export function announcesBlock({ own }: { own: string }): boolean {
  return /^[>|][-+]?$/u.test(own);
}

/**
 * One flat front-matter scalar as it should be written after the `key: `, quoted only when the reader would not
 * give a bare spelling back unchanged: it breaks the line (a Unicode line or paragraph separator included), could
 * be misread as quoted, carries whitespace at either end (the reader trims a bare value), or is a lone block
 * indicator (the reader takes it as `>`/`|`).
 *
 * Quoting rather than refusing, because a writer whose return type is a string cannot refuse, and a value the verb
 * RESOLVES (a session id from the environment) never passes a flag check: MEASURED, a newline-bearing
 * `--branch` authored a complete ask shape as REAL KEYS until this quoted it. An ordinary slug, instant, permalink,
 * path, branch or session id fails every test, so it is written bare and no live row's bytes change — reproduce
 * that with `grep -c '^branch: "' ~/.slopweaver/handovers/*.md`, which reports nothing.
 *
 * @param value the resolved field
 * @returns the bare value, or its double-quoted JSON spelling that {@link decodeFlatScalar} reverses exactly
 */
export function encodeFlatScalar({ value }: { value: string }): string {
  const breaksTheLine =
    value.includes("\n") || value.includes("\r") || UNICODE_SEPARATORS.some(([raw]) => value.includes(raw));
  const couldBeMisreadAsQuoted = value.startsWith('"') || value.startsWith("'");
  const wouldBeTrimmed = value !== value.trim();
  const readsAsBlockIndicator = announcesBlock({ own: value });
  if (breaksTheLine || couldBeMisreadAsQuoted || wouldBeTrimmed || readsAsBlockIndicator) {
    return UNICODE_SEPARATORS.reduce(
      (written, [raw, escaped]) => written.replaceAll(raw, escaped),
      JSON.stringify(value),
    );
  }
  return value;
}

/**
 * One flat scalar's VALUE, its YAML quoting removed — never the spelling.
 *
 * A double-quoted value has `JSON.stringify`'s escapes decoded; a single-quoted one has YAML's doubled `''`
 * collapsed; anything else is returned as it was written.
 *
 * @param value the scalar's written text, after the `key: ` and trimmed
 * @returns the string that was encoded, so `decodeFlatScalar({ value: encodeFlatScalar({ value: v }) })` is `v`
 */
export function decodeFlatScalar({ value }: { value: string }): string {
  const double = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  if (double) {
    return decodeJsonEscapes({ inner: value.slice(1, -1) });
  }
  const single = value.length >= 2 && value.startsWith("'") && value.endsWith("'");
  if (single) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

/** The inside of a double-quoted scalar with every escape in the set decoded, and every other one kept verbatim. */
function decodeJsonEscapes({ inner }: { inner: string }): string {
  return inner.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/gu, (whole: string, escape: string) => {
    if (escape.length === 5) {
      return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    }
    const decoded = SHORT_ESCAPES.get(escape);
    if (decoded === undefined) {
      return whole;
    }
    return decoded;
  });
}
