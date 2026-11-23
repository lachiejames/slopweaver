/**
 * Lexing a Notion enhanced-markdown body into tags, text runs and opaque code blocks. Pure.
 *
 * The measured grammar it reads: {@link ./markdownProjection.js}.
 */

import type { NotionMdCode } from "./markdownNodes.js";

/**
 * Tags Notion writes with NO closing tag and NO self-closing slash — HTML void elements, spelled the HTML way.
 *
 * MEASURED over the same 38 bodies, by counting opens against closes per tag: `br` 249 opens / 0 closes and
 * `col` 32 opens / 0 closes are the ONLY two in that state; every other tag balances exactly. Without this
 * set the lexer reads `<col>` as a container, {@link ./markdownProjection.parseRun} then hunts a `</col>` that
 * never comes, and it
 * swallows the remainder of the stream — which on one real page ate 170 of 176 table cells and 46 of 48 rows,
 * silently. The synthetic unit fixtures did not catch it and could not have: it is a fact about Notion's
 * output, not about the grammar as documented, so it is exactly the class only real bodies expose.
 *
 * Reproduce the open-versus-close census over any collected sample:
 * `grep -o '</\?[a-z][a-z0-9_-]*[^>]*>' <bodies> | sort | uniq -c`
 */
const VOID_TAGS: ReadonlySet<string> = new Set(["br", "col"]);

/** One lexed piece of the source: a tag, or the raw text between tags. */
export type Token =
  | { readonly type: "open" | "close" | "void"; readonly tag: string; readonly attrs: Readonly<Record<string, string>> }
  | { readonly type: "text"; readonly text: string };

/**
 * The attributes of one tag, parsed from its raw attribute string. Pure.
 *
 * @param source everything between the tag name and the closing angle bracket
 * @returns each double-quoted attribute by name; an attribute with no value is absent
 */
function parseAttributes({ source }: { source: string }): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      attrs[name] = value;
    }
    match = pattern.exec(source);
  }
  return attrs;
}

/** A fenced code block found at `from`, or undefined when the source does not open one there. */
function codeFenceAt({
  source,
  from,
}: {
  source: string;
  from: number;
}): { node: NotionMdCode; end: number } | undefined {
  if (!source.startsWith("```", from)) {
    return undefined;
  }
  const infoEnd = source.indexOf("\n", from);
  if (infoEnd === -1) {
    return undefined;
  }
  const info = source.slice(from + 3, infoEnd).trim();
  const closing = source.indexOf("\n```", infoEnd);
  const bodyEnd = closing === -1 ? source.length : closing;
  const end = closing === -1 ? source.length : closing + 4;
  return {
    end,
    node: { kind: "code", language: info.length > 0 ? info : undefined, text: source.slice(infoEnd + 1, bodyEnd) },
  };
}

/**
 * Lex a body into tags, text runs and opaque code blocks. Pure.
 *
 * Code fences are consumed whole BEFORE any tag scanning, because a code block may legitimately contain a
 * `<` and would otherwise lex as markup.
 *
 * @param markdown the raw enhanced-markdown body
 * @returns the token stream, with code blocks already emitted as finished nodes
 */
export function lex({ markdown }: { markdown: string }): readonly (Token | NotionMdCode)[] {
  const out: (Token | NotionMdCode)[] = [];
  let buffer = "";
  let index = 0;
  const flush = (): void => {
    if (buffer.length > 0) {
      out.push({ text: buffer, type: "text" });
      buffer = "";
    }
  };
  while (index < markdown.length) {
    const fence = codeFenceAt({ from: index, source: markdown });
    if (fence !== undefined) {
      flush();
      out.push(fence.node);
      index = fence.end;
      continue;
    }
    const tag = markdown.charAt(index) === "<" ? readTag({ from: index, source: markdown }) : undefined;
    if (tag === undefined) {
      buffer += markdown.charAt(index);
      index += 1;
      continue;
    }
    flush();
    out.push(tag.token);
    index = tag.end;
  }
  flush();
  return out;
}

/**
 * Read one tag starting at `<`, or undefined when the source does not hold a well-formed one there.
 *
 * Hand-rolled rather than a regex, and that is a gate's decision rather than taste: the regex this replaced
 * (`/^<(\/?)([a-z][a-z0-9_-]*)([\s\S]*?)(\/?)$/`) was flagged by `redos-check` for polynomial
 * backtracking, because the lazy middle group and the optional trailing slash can divide the same input many
 * ways. A single forward scan cannot backtrack at all.
 *
 * @param source the whole body
 * @param from the index of the opening angle bracket
 * @returns the token and the index just past its closing bracket, or undefined when this is prose
 */
function readTag({ source, from }: { source: string; from: number }): { token: Token; end: number } | undefined {
  const close = source.indexOf(">", from);
  if (close === -1) {
    return undefined;
  }
  let cursor = from + 1;
  const isClose = source.charAt(cursor) === "/";
  if (isClose) {
    cursor += 1;
  }
  const nameStart = cursor;
  while (cursor < close && isTagNameChar({ char: source.charAt(cursor), first: cursor === nameStart })) {
    cursor += 1;
  }
  const tag = source.slice(nameStart, cursor);
  if (tag.length === 0) {
    return undefined;
  }
  const rest = source.slice(cursor, close);
  const selfClosing = rest.trimEnd().endsWith("/");
  const attrs = parseAttributes({ source: rest });
  if (isClose) {
    return { end: close + 1, token: { attrs, tag, type: "close" } };
  }
  const isVoidTag = selfClosing || VOID_TAGS.has(tag);
  return { end: close + 1, token: { attrs, tag, type: isVoidTag ? "void" : "open" } };
}

/** Whether a character may appear in a tag name at that position. Pure. */
function isTagNameChar({ char, first }: { char: string; first: boolean }): boolean {
  if (char >= "a" && char <= "z") {
    return true;
  }
  if (first) {
    return false;
  }
  return (char >= "0" && char <= "9") || char === "-" || char === "_";
}
