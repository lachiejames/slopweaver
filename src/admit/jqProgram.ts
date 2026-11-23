/**
 * jq and its reimplementations, refused wherever they run — the head of a call, a pipe stage, a wrapper's or
 * `find -exec`'s program, a shell's `-c` payload. jq is banned in this repo: every job has its own
 * command, and raw bash is never needed. `jq -f` as one command was once let through, so every form is covered. A verb reads its own `--json`, the Edit tool edits a file, and a job
 * no verb does is a verb to build. `yq` runs the same expression language over YAML, so it is the same escape.
 * Its own leaf so `./rawBashStage.ts` stays under the file-size ratchet.
 */
import { commandStarts } from "./commandPositions.js";
import { programName, resolveProgram } from "./pythonWrappers.js";
import type { ShellWord } from "./shellLexing.js";

const JQ_PROGRAMS = new Set(["jq", "gojq", "jaq", "yq"]);

/**
 * Whether a resolved program name is jq or one of its reimplementations.
 *
 * @param name the program's basename
 * @returns true when the raw-bash gate refuses it
 */
export function isJqProgram({ name }: { name: string }): boolean {
  return JQ_PROGRAMS.has(name);
}

/**
 * The backstop under the wrapper grammar: jq at ANY place a command can start, by `./commandPositions.ts`'s wider
 * table of exec wrappers, so `chroot /sandbox /usr/bin/jq .` is refused although `./pythonWrappers.ts` stops at
 * `chroot`. A jq in argument position, `grep jq notes.txt`, is never a start.
 *
 * @param words one statement's words, redirections removed
 * @returns true when any command start in it runs jq
 */
export function jqAtAStart({ words }: { words: readonly ShellWord[] }): boolean {
  return commandStarts({ words }).some((at) => {
    const resolved = resolveProgram({ words: words.slice(at) });
    return resolved.kind === "program" && isJqProgram({ name: programName({ text: resolved.words[0]!.text }) });
  });
}
