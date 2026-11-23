/**
 * The one text a memory is COMPARED on, shared by the duplicate scan (CHECK 3) and the enforcement scan (CHECK 5).
 *
 * It is one function rather than two identical ones because the two checks agreeing is a property, not a
 * coincidence: a memory the duplicate scan pairs and the enforcement scan places has to be read the same way in
 * both, or the card contradicts itself about which words a memory is made of. Two copies drift silently — each
 * reads perfectly on its own — and the copies existed before this file did.
 *
 * **The body is never in it.** That is the load-bearing half. Two memories quoting the same paragraph of the owner's are
 * correctly cross-referenced, not duplicated, and a scan that folded bodies in would manufacture a pair out of
 * exactly the behaviour the corpus wants.
 */
import type { MemoryLeaf } from "../types.js";

/**
 * The text one leaf is compared on: its filename stem, its declared name, and its description. Never its body.
 *
 * A leaf with no `name:` is identified by its stem twice over rather than by an invented word — the stem IS its
 * identity when the frontmatter does not give one. A leaf with no `description:` contributes nothing rather than
 * a placeholder, because a placeholder is shared vocabulary between every description-less memory in the corpus
 * and would pair them with each other.
 *
 * @param leaf the memory whose comparison text this is
 * @returns the space-joined text, ready for `distinctiveTokens`
 */
export function memorySubjectText({ leaf }: { leaf: MemoryLeaf }): string {
  const identity = leaf.declaredName === null ? `${leaf.stem} ${leaf.stem}` : `${leaf.stem} ${leaf.declaredName}`;
  if (leaf.description === null) {
    return identity;
  }
  return `${identity} ${leaf.description}`;
}
