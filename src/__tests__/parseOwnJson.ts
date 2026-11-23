/**
 * Parse JSON text a test's OWN run just produced — captured stdout, a file the run wrote, a fixture round
 * trip — never external or untrusted input.
 *
 * A test reading back its own output already knows the shape on the way in; there is no runtime check here
 * that would tell it anything a `zod` schema or an `expect` assertion on the result doesn't already cover
 * better. This exists so that knowledge is stated ONCE, at this one call, rather than as a repeated
 * `JSON.parse(...) as Shape` cast at every site that reads a run's own output back.
 */

/**
 * Parse JSON text this same test produced, into the caller's declared shape.
 *
 * @param text the JSON text, produced by this repository's own code within the same test
 * @returns the parsed value, typed as the caller's declared shape
 */
export function parseOwnJson<T>({ text }: { text: string }): T {
  // `as`: the caller supplies the shape it already knows this text was written in — see the file header.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return JSON.parse(text) as T;
}
