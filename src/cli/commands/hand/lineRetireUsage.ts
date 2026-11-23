/**
 * `hand line-retire`'s usage text — a leaf, so the manifest barrel can quote it without loading the command.
 */

/** The one usage line the manifest and the verb both print. */
export const HAND_LINE_RETIRE_USAGE_LINE =
  'usage: slopweaver hand line-retire [--apply --source-sha256 <hex> --reason "<why>"] [--home <dir>] [--json]';

/** The whole usage, printed on `--help` and on a parse error. */
export const HAND_LINE_RETIRE_USAGE =
  `${HAND_LINE_RETIRE_USAGE_LINE}\n` +
  "\n" +
  "Retires an UNREADABLE line of the hand-step register whose step a later, readable line already settled, so every\n" +
  "reader stops reporting it as a gap. The register is append-only and is never edited: a retirement is a row in\n" +
  "hand-steps/unreadable-retirements.jsonl naming the line by number and the sha256 of its text, and the settling\n" +
  "line the same way. A retirement whose bytes no longer match is ignored, and the gap is reported again.\n" +
  "\n" +
  "A line is eligible only when it is JSON, a posted row with a string step id and no `settles`, and a LATER readable\n" +
  "line settles that exact id. Every other unreadable line is refused and named — it may be a step still waiting on the\n" +
  "owner.\n" +
  "\n" +
  "  (bare)            PREVIEW, read-only: each eligible and refused line, the register's sourceSha256, and the\n" +
  "                    exact apply command\n" +
  "  --apply           append a retirement for every eligible line, under the register's lock, then read back\n" +
  "  --source-sha256   the digest the preview printed; the apply refuses when the register has changed since\n" +
  "  --reason          why, in the operator's words, recorded on every row";
