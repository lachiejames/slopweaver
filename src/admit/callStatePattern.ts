/**
 * How the call-state tripwire (`./callStateGuard.ts`) writes one operand as a path pattern: a quoted glob character
 * escaped so it reads literally, and everything from the first expansion on read as `*` below the directory written
 * before it. An expansion can hold a `/`, so the pattern stops there, and the guard's ancestor rule judges whatever it
 * could name: `rm "$SLOPWEAVER_HOME/talk/calls/$id.jsonl"` reaches the calls directory, and a relative
 * `rm "${X:-live.jsonl}"` reaches whatever its directory holds. A process substitution is not a path and the guard
 * leaves it unjudged before it gets here.
 */
import { dirname, join } from "node:path";

import type { ShellWord } from "./shellLexing.js";

/** The characters a pattern reads as glob syntax, escaped with a backslash when written literally. */
const GLOB_CHARACTERS = /[*?[\]{}\\]/gu;

/** An expansion the shell rewrites: a variable, parameter or command substitution. */
const EXPANSION = /[$`]/u;

/**
 * Text with every glob character escaped, so a pattern reads it literally.
 *
 * @param text literal text, such as a home directory's path
 * @returns the text as a pattern matching only itself
 */
export function literal({ text }: { text: string }): string {
  return text.replace(GLOB_CHARACTERS, "\\$&");
}

/**
 * Where a word's first expansion sits at or after `start`, or `-1` when it has none. Only a word the lexer marked
 * dynamic carries one: in a word it did not, a `$` was single quoted and is literal.
 *
 * @param word the operand as lexed
 * @param start where its part still to be read begins
 * @returns the index of the expansion in the word's text, or `-1`
 */
export function expansionAt({ word, start }: { word: ShellWord; start: number }): number {
  const match = EXPANSION.exec(word.text.slice(start));
  if (match === null || !word.dynamic) {
    return -1;
  }
  return start + match.index;
}

/**
 * The part of a word after `start` as a pattern, its quoted glob characters escaped; from its first expansion on, `*`
 * in the directory written before the expansion.
 *
 * @param word the operand as lexed
 * @param start where the part to write begins, past any prefix the caller has already expanded
 * @returns the pattern
 */
export function patternTail({ word, start }: { word: ShellWord; start: number }): string {
  const cut = expansionAt({ start, word });
  const end = cut === -1 ? word.text.length : Math.max(start, word.text.lastIndexOf("/", cut) + 1);
  let tail = "";
  for (let index = start; index < end; index += 1) {
    const ch = word.text[index]!;
    const quoted = word.shape[index] !== ch;
    tail += quoted ? literal({ text: ch }) : ch;
  }
  return cut === -1 ? tail : `${tail}*`;
}

/**
 * A word opening on an unquoted `~` as a pattern. `~` is the user's home; `~+` is `$PWD`, the directory the segment
 * runs in (`cd <calls> && rm ~+/live.jsonl`); `~-` is `$OLDPWD`, one the shell stood in before (`cd <calls> && cd /tmp && rm ~-/live.jsonl`); and `~name` is that account's home, read as a sibling of the user's
 * (`rm ~<owner>/.slopweaver/talk/…`).
 *
 * @param word the operand as lexed, its shape opening on `~`
 * @param user the user's home, from `$HOME`
 * @param cwd the directory the segment runs in
 * @param oldPwd one directory the shell stood in before
 * @returns the pattern, or `undefined` for a `~` this cannot name: a directory-stack `~2`, a quoted or expanded name,
 *   or a base it does not know
 */
export function tildePattern({
  word,
  user,
  cwd,
  oldPwd,
}: {
  word: ShellWord;
  user: string | undefined;
  cwd: string | undefined;
  oldPwd: string | undefined;
}): string | undefined {
  const prefix = /^~(?:[+-]|[A-Za-z_][\w.-]*)?(?=\/|$)/u.exec(word.text)?.[0];
  if (prefix === undefined || !word.shape.startsWith(prefix)) {
    return undefined;
  }
  const bases: Readonly<Record<string, string | undefined>> = { "~": user, "~+": cwd, "~-": oldPwd };
  const named = user === undefined ? undefined : join(dirname(user), prefix.slice(1));
  const base = prefix in bases ? bases[prefix] : named;
  return base === undefined ? undefined : `${literal({ text: base })}${patternTail({ start: prefix.length, word })}`;
}
