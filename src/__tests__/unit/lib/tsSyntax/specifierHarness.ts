/**
 * What the module-specifier tests of the syntax seam share: a tree's answer for one text, and the characters a
 * fixture spells by code point so the source file stays plain ASCII.
 */
import { moduleSpecifiersOf, withSourceFile } from "#lib/tsSyntax.js";

/**
 * A tree's answer for one text.
 *
 * @param text the file's contents
 * @param fileName the name the script kind is inferred from
 * @returns what `moduleSpecifiersOf` reads off the tree
 */
export function fromTree({ text, fileName = "x.ts" }: { text: string; fileName?: string }): readonly string[] {
  return withSourceFile({ fileName, text, use: (sourceFile) => moduleSpecifiersOf({ sourceFile }) });
}

export const NEXT_LINE = String.fromCodePoint(0x85);
export const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
export const BACKSLASH = String.fromCodePoint(0x5c);
