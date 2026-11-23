/**
 * The environments a command's own assignments can leave its later words expanded under. The call-state tripwire
 * (`./callStateGuard.ts`) expands `$HOME`, `$SLOPWEAVER_HOME` and `$OLDPWD` from the hook's environment, and reads
 * git's work tree from its `GIT_WORK_TREE`, while `HOME=/Users/<owner>; cd "$HOME/.slopweaver/talk/calls" && rm
 * x.jsonl` reaches the live calls directory through an assignment the command makes itself. So each literal
 * assignment to one of them, wherever it sits — a bare one, after `export`, or a single command's prefix — yields one
 * more environment to judge under. Order is not read, so an assignment after the word it would change only
 * over-refuses. A value built at run time (`HOME=$(…)`) names nothing this can know and adds none. Pure, no I/O.
 */
import { tildePattern } from "./callStatePattern.js";
import { type ShellWord, shellWords, slicedWord } from "./shellLexing.js";
import { commandSegments } from "./shellSegments.js";

/** An assignment to a variable the tripwire reads, its name unquoted. */
const ASSIGNMENT = /^(?<name>HOME|SLOPWEAVER_HOME|OLDPWD|GIT_WORK_TREE)=/u;

/**
 * The hook's environment, then one more for each literal assignment the command makes to a variable the tripwire
 * reads, that variable set to the assigned value.
 *
 * @param command the whole command text
 * @param env the hook's own environment
 * @returns every environment to judge the command under, the hook's own first
 */
export function assignedEnvironments({
  command,
  env,
}: {
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): readonly Readonly<Record<string, string | undefined>>[] {
  const words = commandSegments({ command }).flatMap((segment) => shellWords({ text: segment.command }).words);
  const variants = words.flatMap((word) => {
    const name = ASSIGNMENT.exec(word.shape)?.groups?.["name"];
    if (name === undefined || word.dynamic) {
      return [];
    }
    const value = slicedWord({ end: word.text.length, start: name.length + 1, word });
    // An assignment's value expands a leading `~` as a word does (`HOME=~<owner>`).
    const read = value.shape.startsWith("~")
      ? tildePattern({ cwd: undefined, oldPwd: undefined, user: env["HOME"], word: value })
      : value.text;
    return read === undefined ? [] : [{ ...env, [name]: read }];
  });
  return [env, ...variants];
}

/**
 * The environment's `GIT_WORK_TREE` as the leading assignment word it acts as, so a simple command is judged as though
 * it were written `GIT_WORK_TREE=<dir> <command>` — git honours an inherited one exactly as a written one (for example
 * `cd <repo> && git restore -- talk/call-index.txt` under `GIT_WORK_TREE=<home>`). Its value is masked as quoted,
 * since an environment value is never glob-expanded.
 *
 * @param env the environment a command runs under
 * @returns the one assignment word, or none when `GIT_WORK_TREE` is unset
 */
export function inheritedAssignments({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): readonly ShellWord[] {
  const tree = env["GIT_WORK_TREE"];
  if (tree === undefined) {
    return [];
  }
  const prefix = "GIT_WORK_TREE=";
  const shape = `${prefix}${"_".repeat(tree.length)}`;
  return [{ dynamic: false, quoted: true, shape, text: `${prefix}${tree}`, unquotedPrefix: prefix }];
}
