/** `slopweaver handover recheck`'s help — a leaf, so `./recheckRun.ts` holds only the run and the manifest can quote it. */

/** The verb's full help, printed by `--help` and under every usage refusal. */
export const RECHECK_USAGE =
  "usage: slopweaver handover recheck <slug> --still-real <line> [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Offers a held finding again. `handover reconcile` holds a ready finding whose evidence names a file, verb or\n" +
  "pull request the trunk has changed since it was asked, and prints the commits. Read them: settle a row they\n" +
  "answered with `handover settle`; if it is still real, record what you re-ran here. The hold then reads only\n" +
  "trunk commits after this verb's own instant that the row's trunk tip did not already carry.\n" +
  "\n" +
  "  --still-real  the check you re-ran against the trunk that shows the finding still stands\n" +
  "\n" +
  "Writes trunkRecheckedIso:, trunkRechecked: and, when the row's trunk resolves, trunkRecheckedSha: on the row.\n" +
  "Refused on a row that is not an unsettled finding.\n" +
  "\n" +
  'example: slopweaver handover recheck a-finding-row --still-real "settleCardRun.ts at 15f7cd45 still refuses a relay-filed doc"';
