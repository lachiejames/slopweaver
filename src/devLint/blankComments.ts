/*
 * A file's text with every comment blanked out — each found as leading or trailing trivia of a TOKEN of the
 * parsed file — so a LINE gate can read code and only code without guessing from how a line starts.
 *
 * The guess is what this replaces in `./escapeHatch.ts`, and it failed twice under review: skipping a line that
 * starts with `/*` let `/* policy *\/ const open = process.env.ACME_POLICY_OVERRIDE` past, and treating a
 * line that starts with `*` as the inside of a block comment let a generator method `*values() { … }` past. A
 * comment range is the compiler's own answer to both.
 *
 * Every character inside a comment becomes a space and every newline is kept, so line numbers and columns are
 * unchanged. Walking nodes alone once left the body of an empty `{ /* … *\/ }` unblanked, because no node owns
 * it; every comment is trivia of SOME token, so the walk is over tokens.
 */

import { ts, withSourceFile } from "#lib/tsSyntax.js";

/**
 * `content` with every comment range blanked to spaces, newlines kept.
 *
 * @param content the file's text
 * @param path the repo-relative path, which picks the TS or TSX parser
 * @returns text the same length as `content`, the same line for line, with no comment left in it
 */
export function blankComments({ content, path }: { content: string; path: string }): string {
  const ranges = withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly (readonly [number, number])[] => {
      const seen = new Map<number, number>();
      const collect = ({ found }: { found: readonly ts.CommentRange[] | undefined }): void => {
        // The compiler API answers `undefined`, not an empty list, where a position carries no comment.
        if (found === undefined) {
          return;
        }
        for (const range of found) {
          seen.set(range.pos, range.end);
        }
      };
      // Every TOKEN, not only every node: `getChildren` includes punctuation, so a comment no node owns — the
      // body of an empty `{ /* … */ }`, leading trivia of the `}` — is found too.
      const visit = ({ node }: { node: ts.Node }): void => {
        collect({ found: ts.getLeadingCommentRanges(content, node.pos) });
        collect({ found: ts.getTrailingCommentRanges(content, node.end) });
        for (const child of node.getChildren(sf)) {
          visit({ node: child });
        }
      };
      visit({ node: sf });
      return [...seen.entries()];
    },
  });
  // UTF-16 code units, the unit a comment range's positions count in — never code points.
  const chars = content.split("");
  for (const [pos, end] of ranges) {
    for (let index = pos; index < end; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== "\r") {
        chars[index] = " ";
      }
    }
  }
  return chars.join("");
}
