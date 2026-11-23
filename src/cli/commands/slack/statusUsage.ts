/**
 * The `slack status` usage text, in a leaf that imports nothing, so the eager `slack` manifest can quote it
 * without loading the command module (`.claude/rules/area-cli.md` § Metadata is eager).
 */

/** The usage block. Every flag the parser accepts appears here — the help ratchet reads it. */
export const SLACK_STATUS_USAGE =
  "usage: slopweaver slack status set [--text <t>] [--emoji <:name:>] [--until end-of-day|<iso>] [--zone <IANA>] [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver slack status clear [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver slack status show [--zone <IANA>] [--json] [--home <dir>]\n" +
  "       slopweaver slack status presence --to away|auto [--dry-run] [--json] [--home <dir>]\n" +
  "  YOUR status and presence, on your user token (xoxp-). set/clear need users.profile:write, presence\n" +
  "  needs users:write; show reads with users.profile:read and users:read.\n" +
  "  --until end-of-day  expires at the next midnight in --zone (required with it; never guessed)\n" +
  "  --until <iso>       an instant carrying Z or an offset, e.g. 2026-09-26T00:00:00+10:00\n" +
  "  --zone              also renders the expiry as local time in set and show\n" +
  "  --to away           a MANUAL away: it does not expire with the status; --to auto undoes it";
