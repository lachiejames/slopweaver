/**
 * The whole `slopweaver github merge --admin` command a refusal hands its reader, rendered in one place.
 *
 * The verb refuses any call missing `--repo`, `--base`, `--head` or `--description`
 * (`src/cli/commands/github/mergeArgs.ts`), so a hint printing `merge --admin --number <n>` alone names a command
 * that cannot run. Each caller fills what it already holds and passes a `<placeholder>` for what it does not;
 * nothing here invents a value. The spelling is `skills/github/SKILL.md`'s.
 *
 * A filled value is text somebody else chose: a pull request's head branch is named by whoever opened it, and
 * `fix;x` or one carrying `$` is a legal ref. The hint exists to be pasted, so every value crosses
 * {@link shellWord}, which leaves a plain or placeholder value bare and single-quotes anything else.
 */

/** A value made only of characters no POSIX shell treats specially, so it prints bare. */
const SHELL_SAFE = /^[A-Za-z0-9._/-]+$/;

/** Exactly one angle-bracket placeholder, such as `<branch>`, which the reader replaces before running. */
const PLACEHOLDER = /^<[^<>]+>$/;

/**
 * One value as a shell word: bare when it is plain or a placeholder, otherwise single-quoted with each embedded
 * single quote closed, escaped and reopened.
 *
 * @param value the text to print where a reader will paste it into a shell
 * @returns the value, safe to paste as one argument
 */
export function shellWord({ value }: { value: string }): string {
  if (SHELL_SAFE.test(value) || PLACEHOLDER.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Render the complete administrator-merge command for one pull request.
 *
 * @param repo the repository as `owner/name`, or `<owner/name>` when the caller does not hold it
 * @param number the pull request to land
 * @param base the branch it lands on, without the remote, or `<base>` when the caller does not hold it
 * @param head the pull request's head branch, or `<branch>` when the caller does not hold it
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
  base: string;
  head: string;
}): string {
  return (
    `slopweaver github merge --repo ${shellWord({ value: repo })} --base origin/${shellWord({ value: base })} ` +
    `--head ${shellWord({ value: head })} --description - --admin --number ${String(number)} < body.md`
  );
}
