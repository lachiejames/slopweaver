/**
 * The whole `slopweaver github merge --admin` command a refusal hands its reader, rendered in one place.
 *
 * The verb refuses any call missing `--repo`, `--base`, `--head` or `--description`
 * (`src/cli/commands/github/mergeArgs.ts`), so a hint printing `merge --admin --number <n>` alone names a command
 * that cannot run. Each caller fills what it already holds and passes `undefined` for what it does not; nothing
 * here invents a value. The spelling is `skills/github/SKILL.md`'s.
 *
 * A filled value is text somebody else chose: a pull request's head branch is named by whoever opened it, and
 * `fix;x`, one carrying `$`, or one shaped like `<x;id>` is a legal ref. The hint exists to be pasted, so every
 * filled value crosses {@link shellWord}. A placeholder is printed only for a field the caller left
 * `undefined`, never decided from a value's shape, so no filled value can pass as one.
 */

/** A value made only of characters no POSIX shell treats specially, so it prints bare. */
const SHELL_SAFE = /^[A-Za-z0-9._/-]+$/;

/**
 * One value as a shell word: bare when it is plain, otherwise single-quoted with each embedded single quote
 * closed, escaped and reopened.
 *
 * @param value the text to print where a reader will paste it into a shell
 * @returns the value, safe to paste as one argument
 */
export function shellWord({ value }: { value: string }): string {
  if (SHELL_SAFE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * A field the caller holds, quoted, or the caller's placeholder for one it does not.
 *
 * @param value what the caller holds, or `undefined` when it holds nothing for this field
 * @param placeholder the angle-bracket name printed in its place, chosen here and never by the caller's data
 * @returns the shell word to print
 */
function field({ value, placeholder }: { value: string | undefined; placeholder: string }): string {
  if (value === undefined) {
    return placeholder;
  }
  return shellWord({ value });
}

/**
 * Render the complete administrator-merge command for one pull request.
 *
 * @param repo the repository as `owner/name`
 * @param number the pull request to land
 * @param base the branch it lands on, without the remote, or `undefined` when the caller does not hold it
 * @param head the pull request's head branch, or `undefined` when the caller does not hold it
 * @returns the command, description read from `body.md` on standard input
 */
export function adminMergeCommand({
  repo,
  number,
  base,
  head,
}: {
  repo: string;
  number: number;
  base: string | undefined;
  head: string | undefined;
}): string {
  return (
    `slopweaver github merge --repo ${shellWord({ value: repo })} ` +
    `--base origin/${field({ placeholder: "<base>", value: base })} ` +
    `--head ${field({ placeholder: "<branch>", value: head })} --description - ` +
    `--admin --number ${String(number)} < body.md`
  );
}
