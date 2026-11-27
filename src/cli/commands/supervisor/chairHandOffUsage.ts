/**
 * `supervisor hand-off`'s usage, a leaf the manifest quotes and the command prints (`./chairHandOffRun.ts`).
 */

/** `supervisor hand-off`'s usage. */
export const CHAIR_HAND_OFF_USAGE =
  'usage: slopweaver supervisor hand-off [--home <dir>] [--plan <alias>] [--now --reason "<why>"] [--note-wait <seconds>]\n' +
  '       slopweaver supervisor hand-off hold|release --reason "<why>" [--home <dir>]\n' +
  "       slopweaver supervisor hand-off note --episode <id> --file <path> [--home <dir>]\n" +
  "\n" +
  "Replaces the pinned app chair when `supervisor chair-watch` says hand-off: asks the outgoing chair for a note\n" +
  "(delivered once its turn ends), waits up to --note-wait seconds (default 600), closes its run, writes the\n" +
  "successor doc with the note or, without one, the rebuild-from-files instruction, and seats the successor in a\n" +
  "visible app card on the watch's plan. Journalled per chair, so a second run resumes where the first stopped.\n" +
  "\n" +
  "Overrides: hold|release stops or resumes automatic hand-off; --now --reason hands off a chair the watch would\n" +
  "keep (never a cmux or unresolved one); --plan seats the successor on another plan. `note` is the one verb the\n" +
  "outgoing chair runs: it records the note, and never spawns or finishes anything.\n" +
  "\n" +
  "example: slopweaver supervisor hand-off --plan plan-four";
