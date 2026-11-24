/**
 * The `slopweaver github pr update` command a refusal hands its reader when the way forward is to change a pull
 * request that already exists, rendered in one place.
 *
 * It names `--edit`, never `--pull` then `--file`: an edit changes only the fields it names and re-renders the
 * rest from the live description, while a pulled file is a whole replacement that `pr update` refuses without
 * an override (`src/cli/commands/github/updateCore.ts`, `replaceDecisionFor`). The edit is read from
 * `edit.json` on standard input, which the reader writes first; nothing here invents its contents. The
 * repository is somebody else's text, so it crosses {@link shellWord} exactly as `./adminMergeCommand.ts` does.
 */
import { shellWord } from "./adminMergeCommand.js";

/**
 * Render the field-edit update command for one pull request.
 *
 * @param repo the repository as `owner/name`, in the casing the caller was given
 * @param number the pull request to update
 * @returns the command, its edit read from `edit.json` on standard input
 */
export function prUpdateCommand({ repo, number }: { repo: string; number: number }): string {
  return `slopweaver github pr update --repo ${shellWord({ value: repo })} --number ${String(number)} --edit - < edit.json`;
}
