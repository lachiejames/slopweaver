/**
 * Bytes as text only when that text is the bytes — the check every verbatim record in the store shares.
 *
 * An owner turn and a measurement file are both stored so that a restore can write back exactly what was
 * read. A decoder that normalises anything — a byte-order mark, an invalid sequence replaced by U+FFFD —
 * would store something nobody wrote, so the round trip is compared rather than trusted.
 */

/**
 * The bytes as text, only when that text encodes back to the very same bytes.
 *
 * `ignoreBOM` keeps a leading byte-order mark IN the text rather than silently dropping it, and the
 * round-trip comparison is what catches everything a decoder might otherwise normalise.
 *
 * @param bytes the file's contents
 * @returns the text, or `undefined` when no text reproduces the bytes
 */
export function decodeExactly({ bytes }: { bytes: Uint8Array }): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
  if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes))) {
    return undefined;
  }
  return text;
}
