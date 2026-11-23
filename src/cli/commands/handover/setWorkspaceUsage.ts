/** `slopweaver handover set-workspace`'s help — a leaf, so `./setWorkspaceRun.ts` holds only the run and the manifest can quote it. */

/** The verb's full help, printed by `--help` and under every usage refusal. */
export const SET_WORKSPACE_USAGE =
  "usage: slopweaver handover set-workspace <slug> [<slug> ...] --workspace team|self --because <why> " +
  "[--dir <path>] [--home <dir>]\n" +
  "       slopweaver handover set-workspace --respell [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "States whose work a board row is, which the console's workspace selector reads. `repo:` cannot say it:\n" +
  "that is only the checkout a seat runs in, and every fleet session runs in Slopweaver's.\n" +
  "\n" +
  "  --workspace  team (the work reaches a colleague or a company repository) or self (this instance's own\n" +
  "               engineering). The work's destination decides, never that the fleet produced the card\n" +
  "  --because    why, in one line — written beside it as workspaceBecause:, so the row carries its reason\n" +
  "  --respell    instead of slugs: rewrite every row whose workspace: line still spells an old word into the\n" +
  "               role it reads as, keeping its workspaceBecause:. A board with none writes nothing\n" +
  "\n" +
  "A judgement, so it may replace a value the row already states. Setting the same value writes nothing.\n" +
  "\n" +
  'example: slopweaver handover set-workspace iso-compliance-violations-bigtask --workspace team --because "the ISO 27001 audit is the organisation\'s"';
