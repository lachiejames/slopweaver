/**
 * How a command line moves and splits, for `./wholeTreeCheck.ts`: which directory a `cd`, `pushd` or `popd`
 * leaves the walk in, the command lists a bare `&` separates inside one segment, and a subshell's closing
 * `)` peeled off the words. What each program MEANS stays in `./wholeTreeCheck.ts`; this module only says
 * where and what runs. An unknown directory is always `undefined`, never a guess, because a guessed one is
 * how an exemption leaks.
 */
import { posix } from "node:path";

import { type ShellWord, shellWords, withoutRedirections } from "./shellLexing.js";

/** Builtins that move the shell's directory for every segment after them. */
export const DIRECTORY_BUILTINS: ReadonlySet<string> = new Set(["cd", "pushd", "popd"]);

/**
 * Where a `cd` leaves the walk. An operand the lexer cannot read literally, or one climbing above an unknown
 * start, leaves the directory unknown.
 *
 * @param from the directory before it, when known
 * @param to the `cd` operand
 * @returns the directory after it, when known
 */
export function changedDirectory({
  from,
  to,
}: {
  from: string | undefined;
  to: ShellWord | undefined;
}): string | undefined {
  if (to === undefined || to.dynamic) {
    return undefined;
  }
  if (from === undefined) {
    // Normalised even from an unknown start, so `app/..` is never read as app/; a path climbing above that
    // start lands somewhere unknown.
    const normal = posix.normalize(to.text);
    return normal === ".." || normal.startsWith("../") ? undefined : normal;
  }
  return posix.resolve(from, to.text);
}

/**
 * A segment's words with a subshell's closing `)` peeled off, so `(yarn typecheck)` names `typecheck`.
 *
 * @param words the segment's words, redirections removed
 * @returns the same words, trailing unquoted `)` dropped and a word left empty by it removed
 */
export function withoutSubshellClose({ words }: { words: readonly ShellWord[] }): readonly ShellWord[] {
  return words
    .map((word) => (word.quoted ? word : { ...word, text: word.text.replace(/\)+$/u, "") }))
    .filter((word) => word.text.length > 0);
}

/**
 * A segment's words split at every bare `&`, each list a command of its own: `true & yarn typecheck` runs
 * both, and the shared segmenter's separator set is deliberately narrower than bash's.
 * The TEXT is cut where the lexer read a bare `&` and each piece lexed alone, so a word quoted on one side of
 * the `&` does not hide the command on the other: `echo "x"&yarn typecheck`.
 *
 * @param text one segment's command text
 * @returns each command list's words, redirections removed, in order, empty ones dropped
 */
export function backgroundLists({ text }: { text: string }): readonly (readonly ShellWord[])[] {
  const cuts = [...shellWords({ text }).ampersands, text.length];
  return cuts
    .map((cut, at) => text.slice(at === 0 ? 0 : cuts[at - 1]! + 1, cut))
    .map((piece) => withoutRedirections({ words: shellWords({ text: piece }).words }))
    .filter((list) => list.length > 0);
}

/**
 * Where a `cd`, `pushd` or `popd` leaves the walk. Its options are skipped and `--` ends them; a stack
 * move, `-`, `~` or no operand at all leaves the directory unknown, which is read as a Slopweaver one
 * (`cd -- <root>` from inside a sub-directory was once read as `<sub-directory>/--`).
 *
 * @param from the directory before it, when known
 * @param words the builtin and its arguments
 * @returns the directory after it, when known
 */
export function directoryAfter({
  from,
  words,
}: {
  from: string | undefined;
  words: readonly ShellWord[];
}): string | undefined {
  if (words[0]!.text === "popd") {
    return undefined;
  }
  const args = words.slice(1);
  const end = args.findIndex((word) => word.text === "--");
  const operand = end === -1 ? args.find((word) => !/^-./u.test(word.text)) : args[end + 1];
  if (operand === undefined || /^[-+~]/u.test(operand.text)) {
    return undefined;
  }
  return changedDirectory({ from, to: operand });
}

/** The options a wrapper changes directory with before it runs the program: `sudo -C` is close-from, not this. */
const CHDIR_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  env: ["-C", "--chdir"],
  sudo: ["-D", "--chdir"],
};

/**
 * Where the program runs once the wrappers in front of it have moved: `env -C <dir> yarn typecheck` from a
 * foreign directory runs in `<dir>`. The move is the program's alone, never the
 * shell's, so it is never carried to the next segment. A value the lexer cannot read literally leaves the
 * directory unknown, as `cd` does.
 *
 * @param from the directory the command line is in, when known
 * @param words the segment's words, wrappers still in front
 * @param program the program and its arguments, as `resolveProgram` found them at the end of `words`
 * @returns the directory the program runs in, when known
 */
export function wrappedDirectory({
  from,
  program,
  words,
}: {
  from: string | undefined;
  program: readonly ShellWord[];
  words: readonly ShellWord[];
}): string | undefined {
  const prefix = words.slice(0, words.length - program.length);
  let cwd = from;
  let options: readonly string[] = [];
  for (const [index, word] of prefix.entries()) {
    const wrapper = CHDIR_OPTIONS[word.text.slice(word.text.lastIndexOf("/") + 1)];
    if (wrapper !== undefined && !word.quoted) {
      options = wrapper;
      continue;
    }
    const move = chdirValue({ next: prefix[index + 1], options, word });
    if (move !== "none") {
      cwd = move === undefined || /^[-~]/u.test(move.text) ? undefined : changedDirectory({ from: cwd, to: move });
    }
  }
  return cwd;
}

/**
 * The directory one wrapper word moves to: spaced (`-C dir`, `--chdir dir`), attached (`--chdir=dir`, `-Cdir`)
 * or at the end of a bundle of short flags (`-iC dir`, `-iCdir`).
 *
 * @returns it, `undefined` when it cannot be read, or `none` when the word moves nothing
 */
function chdirValue({
  next,
  options,
  word,
}: {
  next: ShellWord | undefined;
  options: readonly string[];
  word: ShellWord;
}): ShellWord | undefined | "none" {
  const { text } = word;
  const long = options.find((option) => option.startsWith("--") && text.startsWith(`${option}=`));
  if (long !== undefined) {
    return { ...word, text: text.slice(long.length + 1) };
  }
  if (options.includes(text)) {
    return next;
  }
  const letter = options.find((option) => !option.startsWith("--"))?.slice(1);
  const at = letter === undefined || !/^-[A-Za-z]/u.test(text) ? -1 : text.indexOf(letter, 1);
  if (at === -1) {
    return "none";
  }
  const rest = text.slice(at + 1);
  return rest.length === 0 ? next : { ...word, text: rest };
}

/** A bare `&`: not `&&`, and not a redirection's `>&`, `&>`, `<&` or `|&`. */
const BARE_AMPERSAND = /(?<![&<>|])&(?![&>])/gu;

/**
 * The part of a segment that runs in THIS shell: the text after its last bare `&`, since every list before one
 * runs in a background subshell whose `export` dies with it — `export NAME=1 & wait; cmd` leaves `cmd`
 * uncovered. A `&` inside quotes is cut too, which can only drop an export, never add one.
 *
 * @param command the segment's own command text
 * @returns the foreground command list's text
 */
export function foregroundCommand({ command }: { command: string }): string {
  const cuts = [...command.matchAll(BARE_AMPERSAND)];
  const last = cuts.at(-1);
  return last === undefined ? command : command.slice(last.index + 1);
}
