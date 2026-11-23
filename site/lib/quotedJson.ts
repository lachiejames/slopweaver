/**
 * JSON for a block of quoted data a model reads between two fixed delimiters: `JSON.stringify`, with `<` and the three
 * characters a line reader may take as a line break escaped, so nothing inside a string can close the block or open a
 * tag. Shared by the spoken record and the voice's provenance (`./talkVoiceRecord.ts`, `./talkVoiceProvenance.ts`).
 */

/**
 * The value as escaped JSON.
 *
 * @param data what to serialise, a bounded record the caller shaped
 * @returns the JSON, every `<`, U+0085, U+2028 and U+2029 written as a `\u` escape
 */
export function quotedJson({ data }: { data: unknown }): string {
  return JSON.stringify(data).replaceAll(
    new RegExp(`[<${String.fromCharCode(0x85, 0x20_28, 0x20_29)}]`, "gu"),
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
