/**
 * `slopweaver linear issues`'s usage line, and nothing else.
 *
 * A LEAF on purpose, the same as `labelsUsage.ts`: `cli/manifests/linear.ts` reads it on every invocation, so it
 * imports nothing at all. `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver linear issues`'s usage line. */
export const LINEAR_ISSUES_USAGE =
  "usage: slopweaver linear issues [--team <team-key>] [--project <uuid|url>] [--creator me] " +
  "[--created-since <iso|Nd>] [--json] [--home <dir>]\n" +
  "  Lists EVERY issue one team and/or one project holds, live — complete or refused, never a first page,\n" +
  "  archived ones included and marked — so a set about to be moved, detached or restored is the whole set.\n" +
  "  A walk is not a snapshot: an issue created or moved in DURING it can be missed, so re-run after acting\n" +
  "  --team              the team's key as it appears in an issue identifier (the `ENG` in `ENG-42`)\n" +
  "  --project           a project UUID or its linear.app URL; with --team, only that team's issues in it\n" +
  "  --creator me        only issues the token's own user filed (the fleet files as them)\n" +
  "  --created-since     an ISO date, or `<n>d` for the last n days\n" +
  "  --json              emit one machine-readable document\n" +
  "  --home              resolve the credential from this Slopweaver state home";
