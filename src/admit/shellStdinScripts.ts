/**
 * The script a shell reads from stdin, for the browser-launch walk (`./browserLaunchCommand.ts`): `bash <<EOF` or
 * `sh <<< '…'` with no `-c` and no script operand runs its heredoc or here-string as a program, so the walk reads
 * each one again as a line.
 */
import { programName } from "./pythonWrappers.js";
import { hereStrings, type ShellWord } from "./shellLexing.js";
import type { CommandSegment } from "./shellSegments.js";
import { stdinHeredocIndex } from "./stdinHeredoc.js";

/** Shells whose `-c` script is itself a command line, as `./segmentWalk.ts` names them. */
export const SHELL_RUNNERS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** Shell long options that take the next word as their value. */
const SHELL_VALUED_LONG: ReadonlySet<string> = new Set(["--init-file", "--rcfile"]);

/**
 * Whether a shell's arguments leave it reading its script from stdin: no `-c` among its options, and either no
 * operand at all or an `-s` before the first one, which makes every operand a positional parameter — `bash -s arg
 * <<EOF` still runs the heredoc. An `-o`/`+o`/`-O`/`+O` takes the next word as its value, once per
 * such letter in a cluster as `set -euo pipefail` does, and so do `--rcfile` and `--init-file`: `bash -o errexit <<EOF`
 * runs the heredoc, `errexit` being no script.
 *
 * @param args the words after the shell's name
 * @returns true when stdin is the script
 */
function shellReadsStdin({ args }: { args: readonly string[] }): boolean {
  let stdinFlag = false;
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at]!;
    if (word === "--") {
      return stdinFlag || at === args.length - 1;
    }
    if (!/^[-+]/.test(word)) {
      return stdinFlag;
    }
    if (/^-[a-z]*c/i.test(word)) {
      return false;
    }
    stdinFlag = stdinFlag || /^-[a-z]*s/i.test(word);
    at += optionValueCount({ word });
  }
  return true;
}

/**
 * How many following words one shell option takes as its values.
 *
 * @param word one option word, `-` or `+` first
 * @returns one per `o`/`O` in a short cluster, one for a valued long option, else none
 */
function optionValueCount({ word }: { word: string }): number {
  if (word.startsWith("--")) {
    return SHELL_VALUED_LONG.has(word) ? 1 : 0;
  }
  return word.slice(1).replaceAll(/[^oO]/g, "").length;
}

/**
 * Each body a stdin-reading shell in one segment runs as its script.
 *
 * @param programs the segment's programs, wrappers peeled
 * @param segment the segment, its heredoc bodies attached
 * @param words the segment's lexed words, for its here-strings
 * @returns each body a stdin-reading shell runs, or none
 */
export function shellStdinScripts({
  programs,
  segment,
  words,
}: {
  programs: readonly (readonly string[])[];
  segment: CommandSegment;
  words: readonly ShellWord[];
}): readonly string[] {
  const readsStdin = programs.some(
    (program) =>
      SHELL_RUNNERS.has(programName({ text: program[0]! }).toLowerCase()) &&
      shellReadsStdin({ args: program.slice(1) }),
  );
  if (!readsStdin) {
    return [];
  }
  // Only the heredoc stdin ends up on is the script: `bash <<'A' <<'B'` runs `B`, and `A` is inert.
  const heredoc = stdinHeredocIndex({ command: segment.command });
  const attached = heredoc === undefined ? [] : segment.heredocs.slice(heredoc, heredoc + 1).map((body) => body.body);
  return [...hereStrings({ words }), ...attached];
}
