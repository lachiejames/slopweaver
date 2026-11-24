/**
 * The whole `slopweaver github merge --admin` command a refusal hands its reader, rendered in one place.
 *
 * The verb refuses any call missing `--repo`, `--base`, `--head` or `--description`
 * (`src/cli/commands/github/mergeArgs.ts`), so a hint printing `merge --admin --number <n>` alone names a command
 * that cannot run. Each caller fills what it already holds and passes a `<placeholder>` for what it does not;
 * nothing here invents a value. The spelling is `skills/github/SKILL.md`'s.
 */

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
    `slopweaver github merge --repo ${repo} --base origin/${base} --head ${head} --description - ` +
    `--admin --number ${String(number)} < body.md`
  );
}
