/**
 * The result shape, the option/operand split and how a wrapper's or git's own `cd` re-roots a path (`under`) every
 * program grammar of the call-state tripwire shares (`./callStateOperands.ts`, `./callStateGitOperands.ts`); which
 * directory the wrappers move to is `./wrappedProgram.ts`'s `wrapperChdir`, beside the wrapper option grammar it
 * needs. Pure, no I/O.
 */
import { toolName } from "./commandTokens.js";
import { type ShellWord, slicedWord } from "./shellLexing.js";

/** What one command would destroy: the words naming it, and whether it cleans the whole directory it runs in. */
export interface DestructiveOperands {
  /** The words whose paths it removes, moves or overwrites, as written. */
  readonly words: readonly ShellWord[];
  /**
   * A git command that cleans or discards from where it runs (`clean`, `reset --hard`, a forced `checkout`, a magic
   * pathspec): the caller judges the segment's own directory, and any live home holding a directory it judges, since
   * git reaches the whole repository above it.
   */
  readonly cleansCwd: boolean;
}

/** A command that destroys nothing. */
export const NOTHING_DESTROYED: DestructiveOperands = { cleansCwd: false, words: [] };

/**
 * The program a word runs, case folded: the owner's Mac's filesystem ignores case, so `/bin/RM`, and `RM` found on the
 * `PATH`, run `rm`. A builtin is matched exactly by the shell, so folding one only ever over-refuses.
 *
 * @param text the word as written
 * @returns its program name, lower case
 */
export function programName({ text }: { text: string }): string {
  return toolName({ first: text }).toLowerCase();
}

/**
 * A program word the shell rewrites before it runs — an expansion (`$RM`) or an unquoted brace or glob (`r{m,m}`
 * runs `rm`) — so its name cannot be read. A bare `[` or `[[` is the test command, not a glob.
 *
 * @param word the program's word as lexed
 * @returns whether the program it runs is unknown
 */
export function unreadableProgram({ word }: { word: ShellWord }): boolean {
  return word.dynamic || (word.text !== "[" && word.text !== "[[" && /[{*?[]/u.test(word.shape));
}

/**
 * A word that is an option rather than an operand: it opens with `-` and is not a lone `-`.
 *
 * @returns whether the word is an option
 */
export function isOption({ word }: { word: ShellWord }): boolean {
  return word.text.startsWith("-") && word.text !== "-";
}

/**
 * Whether the unquoted character at `index` of a word's shape separates two commands: a lone background `&` (not part
 * of `&&`, `&>`, `>&` or `|&`), a subshell's `(` opening the word (not `((`), or a `)` closing a word holding no `(`
 * (so `f()`, `$(…)` and `<(…)` keep theirs).
 */
function separatesAt({ shape, index }: { shape: string; index: number }): boolean {
  const ch = shape[index];
  if (ch === "&") {
    return !/[&<>|]/u.test(shape.charAt(index - 1)) && !/[&>]/u.test(shape.charAt(index + 1));
  }
  if (ch === "(") {
    return index === 0 && shape[1] !== "(";
  }
  return ch === ")" && index === shape.length - 1 && !shape.includes("(");
}

/**
 * A command's words split into the simple commands it runs: at each unquoted lone `&`, which runs what precedes it in
 * the background and goes on to what follows (`true & rm call-index.txt` runs the `rm`), and at a subshell's
 * parentheses (`(rm live.jsonl)`). A `cd` before either runs elsewhere or in a subshell, so every piece is
 * judged from the same directory. A separator glued to a word (`true&rm`, `(rm`) cuts it too.
 *
 * @param words the segment's words, glued redirection operators already cut out (`splitOperators`)
 * @returns each command the segment runs, in order; one piece when it holds no separator
 */
export function commandPieces({ words }: { words: readonly ShellWord[] }): readonly (readonly ShellWord[])[] {
  const pieces: ShellWord[][] = [[]];
  for (const part of words.flatMap((word) => wordParts({ word }))) {
    if (part === SEPARATOR) {
      pieces.push([]);
    } else {
      pieces.at(-1)!.push(part);
    }
  }
  return pieces.filter((piece) => piece.length > 0);
}

/**
 * The pieces a hatch leaves to judge: none for a lone command its segment arms, else those not carrying the hatch in
 * their own leading assignments (`NAME=1 rm x`, `env NAME=1 rm x`) — a prefix assignment reaches only its own command,
 * so `NAME=1 true & rm x` runs the `rm` with it closed. An `export`ed hatch is not told apart from a prefix
 * one where a segment runs several, so that one shape over-refuses.
 *
 * @param pieces the segment's simple commands, from {@link commandPieces}
 * @param hatched whether the hatch is armed on the segment as a whole
 * @param name the hatch variable, armed by the value `1`
 * @returns the pieces still to judge
 */
export function unhatchedPieces({
  pieces,
  hatched,
  name,
}: {
  pieces: readonly (readonly ShellWord[])[];
  hatched: boolean;
  name: string;
}): readonly (readonly ShellWord[])[] {
  if (hatched && pieces.length === 1) {
    return [];
  }
  return pieces.filter((words) => {
    const end = words.findIndex(
      (word) => word.text !== "env" && !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word.unquotedPrefix),
    );
    const leading = end === -1 ? words : words.slice(0, end);
    return !leading.some((word) => word.text === `${name}=1`);
  });
}

/** The marker {@link wordParts} leaves where a separator was cut out. */
const SEPARATOR = Symbol("separator");

/** One word cut at each command separator in it, a marker left between the pieces. */
function wordParts({ word }: { word: ShellWord }): readonly (ShellWord | typeof SEPARATOR)[] {
  const parts: (ShellWord | typeof SEPARATOR)[] = [];
  let start = 0;
  for (let index = 0; index < word.shape.length; index += 1) {
    if (!separatesAt({ index, shape: word.shape })) {
      continue;
    }
    if (index > start) {
      parts.push(slicedWord({ end: index, start, word }));
    }
    parts.push(SEPARATOR);
    start = index + 1;
  }
  if (start === 0) {
    return [word];
  }
  return start < word.text.length ? [...parts, slicedWord({ end: word.text.length, start, word })] : parts;
}

/**
 * The leading variables an operand reader expands to an absolute directory — `$HOME`, `$SLOPWEAVER_HOME`, `$PWD`, braced
 * or bare. Any other leading expansion reads as `*` from the word's own directory, so it is relative.
 */
export const LEADING_VARIABLE = /^\$(?:\{(HOME|SLOPWEAVER_HOME|PWD)\}|(HOME|SLOPWEAVER_HOME|PWD)(?![A-Za-z0-9_]))/u;

/**
 * A relative word re-rooted under a directory, quoting and expansion facts carried from both — what a wrapper's or
 * git's own `cd` (`env -C`, `git -C`) does to the paths its program names.
 *
 * @param dir the directory the program runs in
 * @param word a path the program names; one opening on `/`, `~` or a {@link LEADING_VARIABLE} is returned unchanged,
 *   and one opening on any other expansion (`"$OTHER"*.tmp`) is relative, read from `dir` like any other
 * @returns the word as a path from where the command was typed
 */
export function under({ dir, word }: { dir: ShellWord; word: ShellWord }): ShellWord {
  if (/^[/~]/u.test(word.text) || LEADING_VARIABLE.test(word.text)) {
    return word;
  }
  const prefixWhole = dir.unquotedPrefix === dir.text;
  return {
    dynamic: dir.dynamic || word.dynamic,
    quoted: dir.quoted || word.quoted,
    shape: `${dir.shape}/${word.shape}`,
    text: `${dir.text}/${word.text}`,
    unquotedPrefix: prefixWhole ? `${dir.text}/${word.unquotedPrefix}` : dir.unquotedPrefix,
  };
}

/**
 * Whether a word opens on an expansion no operand reader knows (`"$OTHER"`), whose value may be absolute or relative.
 *
 * @param word the word as written
 * @returns whether it opens on a `$` that is no {@link LEADING_VARIABLE}
 */
export function opensOnUnknownExpansion({ word }: { word: ShellWord }): boolean {
  return word.text.startsWith("$") && !LEADING_VARIABLE.test(word.text);
}

/**
 * Every reading of a word a program run under `dir` names: re-rooted under it, and — when the word opens on an
 * unknown expansion, which may hold an absolute path the shell hands over before any chdir — as written too (`env -C
 * /tmp rm "$OTHER"` removes whatever `$OTHER` names, wherever that is).
 *
 * @param dir the directory the program runs in
 * @param word a path the program names
 * @returns one reading, or both for an unknown expansion
 */
export function readingsUnder({ dir, word }: { dir: ShellWord; word: ShellWord }): readonly ShellWord[] {
  const moved = under({ dir, word });
  return opensOnUnknownExpansion({ word }) ? [word, moved] : [moved];
}

/** Wrappers that run the program after them. */
export const PREFIXES: ReadonlySet<string> = new Set([
  "arch",
  "caffeinate",
  "command",
  "doas",
  "env",
  "exec",
  "nice",
  "nohup",
  "stdbuf",
  "sudo",
  "time",
  "timeout",
]);

/**
 * The option texts and the operand words of an argument list, an unquoted `--` ending the options.
 *
 * @returns the options as text and the operands as words
 */
export function splitArgs({ args }: { args: readonly ShellWord[] }): {
  options: readonly string[];
  operands: readonly ShellWord[];
} {
  const end = args.findIndex((arg) => arg.text === "--" && !arg.quoted);
  const before = end === -1 ? args : args.slice(0, end);
  const after = end === -1 ? [] : args.slice(end + 1);
  return {
    operands: [...before.filter((word) => !isOption({ word })), ...after],
    options: before.filter((word) => isOption({ word })).map((word) => word.text),
  };
}
