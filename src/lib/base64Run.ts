/**
 * Where a run of base64 text, or of any one character class, ends, found without a regular expression
 * quantified over the run.
 *
 * ## Why a payload-sized string never meets a quantified regex
 *
 * V8 compiles a regular expression WITHOUT optimisation once the isolate has generated over 1 MB of regexp
 * code and holds over 16 MB of executable memory (`TooMuchRegExpCode` in V8's regexp compiler). Unoptimised,
 * a greedy loop such as `[A-Za-z0-9+/]+` pushes backtrack entries for every character it consumes, and the
 * backtrack stack is capped at 64 MiB, so a subject of about four million characters throws
 * `RangeError: Maximum call stack size exceeded`. A briefing image at its 4 MiB cap is 5.6 million base64
 * characters. A long-lived process crosses that threshold by ordinary work: the unit lane's non-isolated fork
 * did, failing `imageCaps.test.ts` on every cold shard and passing it alone.
 *
 * Reproduce the mode in plain Node, where the first line throws and the second does not:
 *
 * ```text
 * node --no-regexp-optimization --eval 'console.log(/^[A-Za-z0-9+/]+$/.test("A".repeat(4194304)))'
 * node --no-regexp-optimization --eval 'console.log(/[^A-Za-z0-9+/=]/.test("A".repeat(4194304)))'
 * ```
 *
 * An UNANCHORED search for one character outside the alphabet holds no backtrack entry per character in
 * either mode, which is why {@link characterRunEnd} is built on one. A bounded header is no exception to the
 * rule unless every quantifier in it is bounded too: `data:[a-z]+\/…` is as payload-sized as the run when a
 * page carries a four-million-letter subtype.
 *
 * Pure: no clock, no filesystem, no network.
 */

/**
 * The first index at or after `from` whose character matches `outside`, a single negated character class
 * naming the run's alphabet — `/[^a-z]/` for a run of lowercase letters. Only a pattern of that shape keeps the
 * search free of per-character backtrack state; anything wider brings the overflow back.
 *
 * @param text the string holding the run
 * @param from the index the run starts at
 * @param outside one negated character class; its flags are ignored, the search always runs global
 * @returns that index, or `text.length` when the run reaches the end of `text`
 */
export function characterRunEnd({ text, from, outside }: { text: string; from: number; outside: RegExp }): number {
  const search = new RegExp(outside.source, "g");
  search.lastIndex = from;
  const hit = search.exec(text);
  if (hit === null) {
    return text.length;
  }
  return hit.index;
}

/**
 * The first index at or after `from` whose character is outside the base64 alphabet, padding `=` included.
 *
 * @param text the string holding the run, typically a whole `data:` URI or a rendered page
 * @param from the index the run starts at, usually just past a `;base64,` header
 * @returns that index, or `text.length` when the run reaches the end of `text`
 */
export function base64RunEnd({ text, from }: { text: string; from: number }): number {
  return characterRunEnd({ from, outside: /[^A-Za-z0-9+/=]/, text });
}
