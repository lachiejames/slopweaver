/**
 * The `git cat-file --batch` answer a salvage scan reads its objects from, parsed — split out of `./salvageScan`
 * along the seam between git's wire format and what the scan decides from it. Every function here is pure and works
 * over BYTES: a header's size is a byte count, so reading the answer as a string first would mis-slice the first
 * multi-byte character.
 */

/** One object as `cat-file --batch` answered it: the type its header names and its raw bytes. */
export interface CatFileObject {
  readonly type: string;
  readonly content: Buffer;
}

/**
 * Split a `cat-file --batch` answer into each object's type and raw bytes, so a reader can refuse bytes of the wrong
 * kind answered under the name it asked for.
 *
 * An object git answers `missing`, an answer that does not parse, or one answering the same name with two different
 * objects is `null` — the caller cannot scan what it could not read. A name asked twice and answered twice alike is
 * kept once, since a caller reading a tree path by path asks for a shared blob more than once.
 *
 * @param output the command's stdout, exactly as git wrote it
 * @returns each object's type and content by name, or `null` when any object was missing or the answer was malformed
 */
export function parseCatFileObjects({ output }: { output: Buffer }): ReadonlyMap<string, CatFileObject> | null {
  const contents = new Map<string, CatFileObject>();
  let offset = 0;
  while (offset < output.length) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) {
      return null;
    }
    const header = /^(\S+) (\S+) (\d+)$/.exec(output.subarray(offset, newline).toString("utf8"));
    if (header === null) {
      return null;
    }
    const start = newline + 1;
    const end = start + Number(header[3]);
    if (end >= output.length || output[end] !== 0x0a) {
      return null;
    }
    const object = { content: output.subarray(start, end), type: header[2]! };
    // A name asked twice is answered twice, identically; one answered with two different objects is not git's, and
    // keeping either would scan bytes the other might hide.
    const earlier = contents.get(header[1]!);
    if (earlier !== undefined && !sameObject({ a: earlier, b: object })) {
      return null;
    }
    contents.set(header[1]!, object);
    offset = end + 1;
  }
  return contents;
}

/**
 * Whether two answers for one name are the same object: one type and the same bytes.
 *
 * @param a the first answer
 * @param b the second answer
 * @returns true when they match exactly
 */
function sameObject({ a, b }: { a: CatFileObject; b: CatFileObject }): boolean {
  return a.type === b.type && a.content.equals(b.content);
}

/**
 * {@link parseCatFileObjects}, answering each object's raw bytes alone, for a reader that already knows every name
 * it asked for is a blob.
 *
 * @param output the command's stdout, exactly as git wrote it
 * @returns each object's content by name, or `null` when any object was missing or the answer was malformed
 */
export function parseCatFileBatch({ output }: { output: Buffer }): ReadonlyMap<string, Buffer> | null {
  const objects = parseCatFileObjects({ output });
  return objects === null ? null : new Map([...objects].map(([sha, object]) => [sha, object.content]));
}
