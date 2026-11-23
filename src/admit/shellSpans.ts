/**
 * The unquoted spans a shell splitter steps over whole rather than cuts: a word-initial `#` comment, a heredoc
 * operator with its delimiter word and descriptor, and an arithmetic or parameter expansion whose `<<` is a shift.
 * Split out of `./shellSegments.ts`, whose `commandSegments` builds on these; `./stdinHeredoc.ts` and
 * `./callStateJudgedText.ts` read them too.
 *
 * Pure, no I/O, and a leaf: nothing here imports `./shellSegments.ts`.
 */
import { delimiterWord } from "./heredocDelimiter.js";
import { closingBracket, closingParen } from "./shellBrackets.js";

/** Characters after which an unquoted `#` starts a word (and so a comment), or a digit run starts a word. */
const WORD_BOUNDARY = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")"]);

/**
 * Whether the `#` at `index` opens a comment — it must start a word, so `$#` and `a#b` never do. A
 * backslash-newline before it is removed before bash reads words, so the character that counts is the one
 * before every such continuation: `printf 'echo a\\\n#b; echo c\n' | /bin/bash` prints `a#b` then `c`.
 *
 * @returns true when bash reads the rest of the line as a comment
 */
export function opensComment({ command, index }: { command: string; index: number }): boolean {
  if (command[index] !== "#") return false;
  let at = index;
  while (at >= 2 && command[at - 1] === "\n" && oddBackslashRunBefore({ command, end: at - 1 })) at -= 2;
  // A `)` closing `$((1))` or `$(x)` ends an expansion inside a word, so `$((1))#x` is one word. Read every `)` that
  // way: one closing a subshell or group is refused on its own, and so is the text after it.
  if (at === 0) return true;
  // An escaped blank or separator is part of the word, so `X\ #Y` is one word (a counterexample).
  if (oddBackslashRunBefore({ command, end: at - 1 })) return false;
  return command[at - 1] !== ")" && WORD_BOUNDARY.has(command[at - 1]!);
}

/** Whether the backslashes ending just before `end` are an odd run, so the last one escapes `end`. */
function oddBackslashRunBefore({ command, end }: { command: string; end: number }): boolean {
  let start = end;
  while (start > 0 && command[start - 1] === "\\") start -= 1;
  return (end - start) % 2 === 1;
}

/** A `<<` operator's parsed delimiter, and the index just past it. */
export interface HeredocOperator {
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly dollarQuoted: boolean;
  readonly stripTabs: boolean;
  readonly descriptor: number;
  readonly end: number;
}

/**
 * The descriptor digits written right before `index`, when they start a word — `3<<EOF` is descriptor 3. A
 * backslash-newline between the digits and the operator is a line continuation the shell removes, so it is
 * stepped over first: a Codex review measured `bash -s 3\⏎<<'A'` binding the body to descriptor 3.
 *
 * @returns the descriptor number, or `undefined` when no digits start a word there
 */
export function descriptorDigits({ command, index }: { command: string; index: number }): number | undefined {
  let end = index;
  while (end >= 2 && command[end - 1] === "\n" && command[end - 2] === "\\") end -= 2;
  let at = end;
  while (at > 0 && /\d/.test(command[at - 1]!)) at -= 1;
  const startsWord = at === 0 || WORD_BOUNDARY.has(command[at - 1]!);
  return at < end && startsWord ? Number(command.slice(at, end)) : undefined;
}

/**
 * Parse the heredoc operator starting at `command[index]`, if there is one: `<<` or `<<-`, optional blanks,
 * then a delimiter word. Quote removal is the shell's, so `'EOF'`, `"EOF"`, `\EOF` and `E'O'F` all name
 * `EOF` — examples, not an exhaustive list. A here-string (`<<<`) is not a heredoc, and neither is an
 * operator with no word after it; a quoted empty delimiter (`<<''`) is one. A NUMERIC delimiter (`<<123`) is
 * accepted too — a Codex review measured bash reading `cat <<123\npython3 -V\n123` as data — and arithmetic
 * such as `$((1 << 2))` is kept out of this function's reach by {@link arithmeticEnd} instead. `let x=1<<2`
 * unquoted is not arithmetic to this splitter and reads as a heredoc, which HIDES the lines after it rather
 * than inventing commands.
 *
 * @param command the full command text
 * @param index the position of the first `<`
 * @returns the parsed operator, or `undefined` when this is not a heredoc
 */
export function heredocOperatorAt({ command, index }: { command: string; index: number }): HeredocOperator | undefined {
  if (!command.startsWith("<<", index) || command[index + 2] === "<") {
    return undefined;
  }
  let at = index + 2;
  const stripTabs = command[at] === "-";
  if (stripTabs) at += 1;
  while (command[at] === " " || command[at] === "\t") at += 1;
  const word = delimiterWord({ at, command });
  if (!word.quoted && word.delimiter.length === 0) {
    return undefined;
  }
  const digits = descriptorDigits({ command, index });
  // A `<<` with no `N` written before it feeds the command's standard input, which is descriptor 0.
  if (digits === undefined) return { ...word, descriptor: 0, stripTabs };
  return { ...word, descriptor: digits, stripTabs };
}

/** How each `$`-opened expansion skipped whole nests and closes, keyed by the bracket opening it. */
const EXPANSION_CLOSE: Readonly<Record<string, { open: string; close: string }>> = {
  "[": { close: "]", open: "[" },
  "{": { close: "}", open: "${" },
};

/**
 * The index just past an arithmetic expansion `$((…))` or `$[…]`, a parameter expansion `${…}` (whose offsets
 * and subscripts are arithmetic) or a word-initial arithmetic command `((…))` opening at `index` — skipped
 * whole, so a `<<` shift inside one is never read as a heredoc: `printf 'cat $[1<<2]\nsleep 1\n2]\n' |
 * /bin/bash` sleeps, and so does `${x:0:1<<2}`.
 *
 * @param command the full command text
 * @param index the position to test
 * @returns the index past the closing bracket, or `undefined` when no such span opens here
 */
export function arithmeticEnd({ command, index }: { command: string; index: number }): number | undefined {
  const bracket = EXPANSION_CLOSE[command.slice(index + 1, index + 2)];
  if (command[index] === "$" && bracket !== undefined) {
    const close = closingBracket({ ...bracket, from: index + 2, text: command });
    return close === -1 ? command.length : close + 1;
  }
  const dollar = command.startsWith("$((", index);
  const bare = command.startsWith("((", index) && (index === 0 || WORD_BOUNDARY.has(command[index - 1]!));
  if (!dollar && !bare) {
    return undefined;
  }
  const close = closingParen({ from: index + (dollar ? 2 : 1), text: command });
  return close === -1 ? command.length : close + 1;
}
