/**
 * A JSDoc tag the compiler did not read: a line inside a `/** *\/` block that OPENS with `@word`, where the parsed
 * block holds no tag starting on that line.
 *
 * Every reader here that takes a tag off a JSDoc block — `jsdoc-tags`' `@param`/`@returns`, `typescript-import-seam`'s
 * JavaScript `@import` edges — reads the compiler's parse, so a tag the parse drops is a finding, a name or an edge
 * that silently is not there. TypeScript 7.1.0-beta drops every tag after an inline run of three or more backticks
 * in a prose line: a run opens a code span that runs to the end of the block. A
 * whole-tree diff of all 135,685 blocks against TypeScript 6.0.3 found four blocks it had emptied, and rewording
 * those four fixed only those four. This check is what closes the class: the source is refused instead of read short.
 *
 * Text and parse are compared LINE BY LINE rather than as counts, so a refusal names the exact line. A tag nested
 * under another (`@property` under `@typedef`) still starts its own line and is collected by walking the block, not
 * by reading only its top-level `tags`. `@word` part way through a line is prose — an email, a package scope, a
 * code span — and is never a tag in either compiler's reading, so only a line's FIRST word counts. A block attached
 * to no node (one left before a closing brace) holds no parsed tag at all, so every tag line in it is refused too.
 *
 * Pure: {@link unreadJsdocTags} parses text in memory. `jsdocTags.ts` runs it over every code extension, wider than
 * its own `.ts` scope, because the import seam reads `@import` out of JavaScript too.
 */

import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

/** One line whose opening `@tag` the compiler's parse did not read as a tag. */
export interface UnreadJsdocTag {
  readonly path: string;
  readonly line: number;
  readonly kind: "unread-tag";
  readonly detail: string;
}

/** The identifier after an `@`: the name the compiler reads a tag by, `$`, `_` and non-ASCII letters included. */
const TAG_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$]*/u;

/** What may stand before a line's tag once an opening `/**` is set aside: blanks and stars only, in any mix. */
const GUTTER = /^[ *]*$/u;

/**
 * The tag word a line opens with, or `undefined`. A line opens with a tag when everything before its first `@` is an
 * optional `/**` and then any mix of blanks and stars — `/*** @import` and `/** * @import` included — because a line
 * whose author wrote a tag there is the subject, so a wider gutter than the compiler accepts is refused too, never let
 * by. Every blank is read with the compiler's own single-line whitespace test, so a form feed and a no-break space are
 * blanks here exactly as they are to it. Plain string tests rather than one pattern, so no gutter shape can backtrack.
 *
 * @param text one line of a block
 * @returns the tag word, or `undefined` when the line opens with none
 */
function openingTag({ text }: { text: string }): string | undefined {
  const at = text.indexOf("@");
  if (at === -1) {
    return undefined;
  }
  const head = Array.from(text.slice(0, at), (ch) => (ts.isWhiteSpaceSingleLine(ch.codePointAt(0)!) ? " " : ch))
    .join("")
    .trimStart();
  const gutter = head.startsWith("/**") ? head.slice(3) : head;
  if (!GUTTER.test(gutter)) {
    return undefined;
  }
  return TAG_NAME.exec(text.slice(at + 1))?.[0];
}

/**
 * Every line terminator the compiler counts — CRLF, a lone CR, a lone LF, and the two Unicode separators U+2028 and
 * U+2029 — so a line here is a line there, and the numbers agree with its own.
 */
const LINE_BREAK = /\r\n|[\r\n\p{Zl}\p{Zp}]/u;

/**
 * The 1-based line of every tag node the parse holds anywhere inside `block`, nested ones included.
 *
 * @param block the parsed JSDoc block
 * @param sf the source file, for line numbers
 * @returns the lines on which a parsed tag starts
 */
function parsedTagLines({ block, sf }: { block: ts.JSDoc; sf: ts.SourceFile }): ReadonlySet<number> {
  const lines = new Set<number>();
  const visit: NodeVisitor = (child) => {
    if (isTag(child)) {
      lines.add(sf.getLineAndCharacterOfPosition(child.tagName.pos).line + 1);
    }
    forEachChild({ node: child, visit });
  };
  forEachChild({ node: block, visit });
  return lines;
}

/**
 * Whether a node inside a JSDoc block is a tag. A 7.1 node answers `undefined` for a field its kind does not carry,
 * so `in` alone does not prove one; inside a block only a tag carries a `tagName` at all.
 */
function isTag(node: ts.Node): node is ts.JSDocTag {
  return "tagName" in node && node.tagName !== undefined;
}

/**
 * Where the `/**` comment a JSDoc node was parsed from starts, or `undefined` when the node is no written block. The
 * scanner's comment ranges are asked rather than `getStart`, because a 7.1 JSDoc node's start can sit on a comment
 * BEFORE its own (a trailing `// note` on the previous line). A range must end where the node ends and start at or
 * after it: TypeScript 7.1 also answers a JSDoc node for each nested tag's own comment (a `@typedef`'s `@property`
 * lines), spanning from that tag's `@`, inside the block — no range starts there, so it is never read as a block
 * whose every line went unread.
 *
 * @param node any node a JSDoc read answered
 * @param sf the source file, for its text
 * @returns the offset of the block's `/**`, or `undefined`
 */
function writtenStart({ node, sf }: { node: ts.Node; sf: ts.SourceFile }): number | undefined {
  if (!ts.isJSDoc(node)) {
    return undefined;
  }
  return ts
    .getLeadingCommentRanges(sf.text, node.pos)
    ?.find((range) => range.end === node.end && range.pos >= node.pos && sf.text.startsWith("/**", range.pos))?.pos;
}

/**
 * Every distinct JSDoc block written in the file with where its `/**` starts, keyed by where it ends so a block
 * attached to two nodes counts once. `getJSDocCommentsAndTags` answers only the LAST of two stacked blocks, while the
 * import seam (`jsDocImportSpecifiersOf`) reads every block a node's `getChildren` lists, so a swallowed `@import` in
 * a shadowed block would be an edge lost with no finding. Both are read here. `getChildren` builds a node's whole
 * child list, so it is asked only of a node carrying JSDoc, the only node a stacked block can sit on.
 */
function jsdocBlocks({ sf }: { sf: ts.SourceFile }): readonly { readonly block: ts.JSDoc; readonly start: number }[] {
  const byEnd = new Map<number, { readonly block: ts.JSDoc; readonly start: number }>();
  const keep = (node: ts.Node): void => {
    const start = writtenStart({ node, sf });
    if (start !== undefined && ts.isJSDoc(node)) {
      byEnd.set(node.end, { block: node, start });
    }
  };
  const visit: NodeVisitor = (node) => {
    const attached = ts.getJSDocCommentsAndTags(node);
    attached.forEach(keep);
    if (attached.length > 0) {
      node.getChildren(sf).forEach(keep);
    }
    forEachChild({ node, visit });
  };
  forEachChild({ node: sf, visit });
  return [...byEnd.values()];
}

/**
 * Where a `/**` comment starting exactly at `at` ends, or `undefined` when `at` starts no comment — it sits inside a
 * token (a string, a template, a regular expression) or inside another comment. Descends through `getChildren`,
 * tokens included, to the child whose leading trivia holds `at`, and asks the scanner for that trivia's comments.
 *
 * @param at the offset of a `/**` in the text
 * @param node the node whose span holds `at`, the source file at the top
 * @param sf the source file, for its text
 * @returns the comment's end offset, or `undefined` when no comment starts at `at`
 */
function commentEndAt({ at, node, sf }: { at: number; node: ts.Node; sf: ts.SourceFile }): number | undefined {
  const child = node
    .getChildren(sf)
    .find((candidate) => !ts.isJSDoc(candidate) && candidate.pos <= at && at < candidate.end);
  if (child === undefined) {
    return undefined;
  }
  if (at >= child.getStart(sf)) {
    return commentEndAt({ at, node: child, sf });
  }
  // The leading ranges start collecting only after a line break, so a block written after code on the same line is
  // trailing trivia instead, and only the trailing ranges answer it.
  const startsHere = (range: ts.CommentRange): boolean =>
    range.pos === at && range.kind === ts.SyntaxKind.MultiLineCommentTrivia;
  const leading = ts.getLeadingCommentRanges(sf.text, child.pos)?.find(startsHere);
  if (leading !== undefined) {
    return leading.end;
  }
  return ts.getTrailingCommentRanges(sf.text, child.pos)?.find(startsHere)?.end;
}

/** One `/**` block the source wrote: its span, and the lines a parsed tag starts on — none for an unattached one. */
interface WrittenBlock {
  readonly start: number;
  readonly end: number;
  readonly parsed: ReadonlySet<number> | undefined;
}

/**
 * Every `/**` block the source wrote: the parsed ones, and every one attached to no node — at the end of a file,
 * before a closing brace — which 7.1 parses no tag in at all, so the import seam reads none of its `@import` edges.
 * Each `/**` in the text not starting a parsed block is checked against the scanner, so one inside a string or
 * another comment is never read as a block.
 */
function writtenBlocks({ sf }: { sf: ts.SourceFile }): readonly WrittenBlock[] {
  const attached = jsdocBlocks({ sf }).map(({ block, start }): WrittenBlock => ({
    end: block.end,
    parsed: parsedTagLines({ block, sf }),
    start,
  }));
  const starts = new Set(attached.map((block) => block.start));
  const unattached = [...sf.text.matchAll(/\/\*\*/gu)].flatMap(({ index: at }): WrittenBlock[] => {
    const end = starts.has(at) ? undefined : commentEndAt({ at, node: sf, sf });
    return end === undefined ? [] : [{ end, parsed: undefined, start: at }];
  });
  return [...attached, ...unattached];
}

/**
 * Why a tag line went unread, for a block the parse holds or one it never attached.
 *
 * @param tag the tag word the line opens with
 * @param parsed whether the block is one the parse attached
 * @returns the finding's detail
 */
function unreadDetail({ tag, parsed }: { tag: string; parsed: boolean }): string {
  if (parsed) {
    return `@${tag} opens this line, but the compiler read no tag here; an inline run of three or more backticks earlier in the block swallows every tag after it, so reword that run`;
  }
  return `@${tag} opens this line, but its block documents no declaration, so the compiler read no tag in it; move the block onto the declaration it documents, or make it a plain comment`;
}

/**
 * Every line in a file's JSDoc blocks that opens with `@tag` where the compiler read no tag.
 *
 * @param path the file's repo-relative path, for reporting and for the script kind
 * @param content the file's text
 * @returns one entry per unread tag line, in source order
 */
export function unreadJsdocTags({ path, content }: { path: string; content: string }): readonly UnreadJsdocTag[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly UnreadJsdocTag[] => {
      const found: UnreadJsdocTag[] = [];
      for (const { start, end, parsed } of writtenBlocks({ sf })) {
        const first = sf.getLineAndCharacterOfPosition(start).line + 1;
        content
          .slice(start, end)
          .split(LINE_BREAK)
          .forEach((text, offset) => {
            const tag = openingTag({ text });
            const line = first + offset;
            if (tag !== undefined && parsed?.has(line) !== true) {
              found.push({
                detail: unreadDetail({ parsed: parsed !== undefined, tag }),
                kind: "unread-tag",
                line,
                path,
              });
            }
          });
      }
      return found.toSorted((a, b) => a.line - b.line);
    },
  });
}
