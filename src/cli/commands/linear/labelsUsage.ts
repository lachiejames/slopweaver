/**
 * `slopweaver linear labels`'s usage line, and nothing else.
 *
 * A LEAF on purpose, the same as `attachUsage.ts`: `cli/manifests/linear.ts` reads it on every invocation, so it
 * imports nothing at all. `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver linear labels`'s usage line. */
export const LINEAR_LABELS_USAGE =
  "usage: slopweaver linear labels --team <team-key> [--json] [--home <dir>]\n" +
  "  Reads every issue label and project label one team can apply, live — its own and the workspace's —\n" +
  "  with each full id, so a form's `labelIds` is copied from a real read rather than guessed\n" +
  "  --team            the team's key as it appears in an issue identifier (the `ENG` in `ENG-42`)\n" +
  "  --json            emit one machine-readable document\n" +
  "  --home            resolve the credential from this Slopweaver state home";
