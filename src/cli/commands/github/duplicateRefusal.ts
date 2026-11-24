/**
 * What `github stack push` prints when its create step meets a branch pair that is already reserved.
 *
 * Split out of `./core.ts`, whose `outcomeLines` prints it, under the file-size ratchet. The usual reason for a
 * second create on the same branches is a description or walkthrough gone stale after a fix push, so the refusal
 * names the command that updates the pull request it cites, as a refusal hint names a command its reader can run.
 */
import { prUpdateCommand } from "../../../outbound/github/prUpdateCommand.js";

/**
 * A duplicate refusal, and the update it points to when it cites a pull request.
 *
 * It names no command when the reservation carries no number, because then there is no pull request to update,
 * nor when the ledger's number is not a positive whole one, which `pr update --number` would refuse: the record
 * is parsed only as a number, so a hand-edited or corrupt `0` reaches here.
 *
 * @param locus the reserved branch pair's ledger key, printed as it is and never parsed
 * @param existing the pull request the reservation records, or `undefined` when it records none
 * @param repo the form target's `owner/name` as the caller spelled it, which the update command prints
 * @returns the refusal line, then the update command when a pull request is cited
 */
export function duplicateRefusalLines({
  locus,
  existing,
  repo,
}: {
  locus: string;
  existing: number | undefined;
  repo: string;
}): readonly string[] {
  const refusal =
    `refused: ${locus} is already reserved` +
    (existing === undefined ? "" : ` by #${String(existing)}`) +
    ". A second pull request for the same branches would be a duplicate, not a retry.";
  if (existing === undefined || !Number.isSafeInteger(existing) || existing < 1) {
    return [refusal];
  }
  return [
    refusal,
    `To bring #${String(existing)} up to date instead, put only the fields to change in edit.json and run:`,
    `  ${prUpdateCommand({ number: existing, repo })}`,
    "  A new walkthrough rides the same call as inline JSON: --self-review '<json>'.",
  ];
}
