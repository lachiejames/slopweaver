/**
 * `slopweaver linear team-membership`'s usage line, and nothing else.
 *
 * A LEAF on purpose, the same as `attachUsage.ts`: `cli/manifests/linear.ts` reads it on every invocation, so it
 * imports nothing at all. `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver linear team-membership`'s usage line. */
export const LINEAR_TEAM_MEMBERSHIP_USAGE =
  "usage: slopweaver linear team-membership <join|leave> --team <team-key> [--apply] " +
  "[--unasked --why <text> --said <text> --by-session <text>] [--home <dir>]\n" +
  "  join|leave    join or leave one team as the token's OWN user; no other person's membership is addressable\n" +
  "  --team        the team's key as it appears in an issue identifier (the `ENG` in `ENG-42`)\n" +
  "  --apply       send the write; without it the verb reads where the user stands and previews only\n" +
  "  --unasked     an act taken without asking: records it in the autonomy ledger with --why, --said and\n" +
  "                --by-session, naming the opposite verb as its rollback\n" +
  "  --home        resolve the credential from this Slopweaver state home";
