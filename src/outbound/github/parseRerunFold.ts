/**
 * The re-run fold of a C3 description read back: where the fold sits in the body, and the items inside it, each read
 * the one way `./render.ts` writes it. Every read declines rather than guesses; `./parse.ts` proves the whole body
 * by re-rendering it.
 */
import { ok, type Result } from "#lib/result.js";
import type { PrBodyError } from "./errors.js";
import { allOf, between, listRows, stop } from "./parseCursor.js";
import { fenceFor, LAYOUT } from "./render.js";
import type { RerunItem } from "./types.js";

/** A canonical fence opening: three or more backticks and a bare language word. */
const CODE_OPEN = /^(`{3,})([A-Za-z0-9_+-]*)\n/;

/** One read re-run item, and how many characters of the rest it took. */
type RerunRead = { item: RerunItem; length: number } | undefined;

/** A command item: a fence the renderer would have picked, its language word and its text. */
function commandItemOf({ rest, opened }: { rest: string; opened: RegExpExecArray }): RerunRead {
  const run = opened[1]!;
  const close = rest.indexOf(`\n${run}`, opened[0].length);
  if (close < 0) {
    return undefined;
  }
  const text = rest.slice(opened[0].length, close);
  // The renderer picks the SHORTEST fence that cannot close early; a fence that merely happens to close is refused.
  if (fenceFor({ text }) !== run) {
    return undefined;
  }
  return { item: { kind: "command", lang: opened[2]!, text }, length: close + 1 + run.length };
}

/** A tests item: a `<ul>` of `<li>` rows. */
function testsItemOf({ rest }: { rest: string }): RerunRead {
  const listEnd = rest.indexOf("\n</ul>");
  if (listEnd < 0) {
    return undefined;
  }
  const rows = listRows({ block: rest.slice(0, listEnd + 6), tag: "ul" });
  const items = allOf({ read: (row) => between({ block: row, close: "</li>", open: "<li>" }), rows });
  return items === undefined ? undefined : { item: { items, kind: "tests" }, length: listEnd + 6 };
}

/** A note item: one `<p>` line. */
function noteItemOf({ rest }: { rest: string }): RerunRead {
  const lineEnd = rest.indexOf("\n");
  const line = lineEnd < 0 ? rest : rest.slice(0, lineEnd);
  const content = between({ block: line, close: "</p>", open: "<p>" });
  return content === undefined ? undefined : { item: { content, kind: "note" }, length: line.length };
}

/** One re-run item at `at`, and where it ends; undefined when none reads there. */
function rerunItemAt({ source, at }: { source: string; at: number }): { item: RerunItem; next: number } | undefined {
  const rest = source.slice(at);
  const opened = CODE_OPEN.exec(rest);
  let read: RerunRead;
  if (opened !== null) {
    read = commandItemOf({ opened, rest });
  } else if (rest.startsWith("<ul>\n")) {
    read = testsItemOf({ rest });
  } else {
    read = noteItemOf({ rest });
  }
  return read === undefined ? undefined : { item: read.item, next: at + read.length };
}

/**
 * The fold's interior read as items: separated by one blank line, ending exactly at the interior's end.
 *
 * @param inner the text between the fold's opening and closing tags
 * @returns the items in order, or undefined when any byte reads as none
 */
export function rerunItemsOf({ inner }: { inner: string }): readonly RerunItem[] | undefined {
  const items: RerunItem[] = [];
  let at = 0;
  for (;;) {
    const read = rerunItemAt({ at, source: inner });
    if (read === undefined) {
      return undefined;
    }
    items.push(read.item);
    if (read.next === inner.length) {
      return items;
    }
    if (!inner.startsWith("\n\n", read.next)) {
      return undefined;
    }
    at = read.next + 2;
  }
}

/**
 * The prefix (without its final newline) split into its main part and the re-run fold's interior.
 *
 * @param text a candidate body prefix, its last newline dropped
 * @returns the main part and the fold's interior, undefined when the body has no fold; or a structure refusal
 */
export function splitFold({
  text,
}: {
  text: string;
}): Result<{ main: string; inner: string | undefined }, PrBodyError> {
  const open = `\n\n${LAYOUT.rerunOpen}\n\n`;
  // The FIRST occurrence: nothing in the main part can carry these bytes, because every cell escapes `<`.
  const at = text.indexOf(open);
  if (at < 0) {
    return ok({ inner: undefined, main: text });
  }
  const close = `\n\n${LAYOUT.rerunClose}`;
  if (!text.endsWith(close) || text.length < at + open.length + close.length) {
    return stop({ at: "the re-run fold" });
  }
  return ok({ inner: text.slice(at + open.length, text.length - close.length), main: text.slice(0, at) });
}
