/**
 * `github cycle`'s usage text. A leaf, for the reason `.claude/rules/area-cli.md` § "Metadata is eager"
 * gives: the manifest reads it eagerly, so it imports nothing.
 */

/** The whole `github cycle` usage block. */
export const GITHUB_CYCLE_USAGE =
  "usage: slopweaver github cycle --repo <owner/name> --number <n> [--prime] [--dry-run] [--json] [--home <dir>]\n" +
  "  Close and reopen an open pull request through the door, so its pull_request CI runs again on a FRESH\n" +
  "  merge commit — the cure when the base moved and `github rerun` would re-run the old merge.\n" +
  "  It first confirms refs/pull/N/merge is the merge of the current head onto the base's live tip.\n" +
  "  Still computing (mergeable null, ref missing or behind, an old head): writes nothing, exit 4, run it again.\n" +
  "  SETTLED onto an old base: refused, exit 1 — a read does not make GitHub recompute it. --prime cycles anyway\n" +
  "  to trigger the recompute (measured on an acme-admin pull request, it followed a reopen); that CI runs the old merge, so run again.\n" +
  "  Refused, exit 1: merged or closed, head fork deleted, auto-merge on, merge-queued, native-stack member,\n" +
  "  conflicted — re-read just before the close, which also defers (exit 4) a head, merge or mergeable that\n" +
  "  moved since the judgement. Not checked: the base moving then, or somebody closing or\n" +
  "  enqueueing it, in the round trip between that last read and the close or reopen.\n" +
  "  --repo <owner/name>  the repository the pull request belongs to\n" +
  "  --number <n>       the pull request\n" +
  "  --prime            cycle a settled stale merge so GitHub recomputes it; that cycle's CI is on the old merge\n" +
  "  --dry-run          read and judge the merge ref, print the verdict, with no write and no door record\n" +
  "  --json             emit one machine-readable document instead of the text report\n" +
  "  --home <dir>       resolve the credential and the door's record from this Slopweaver state home";
