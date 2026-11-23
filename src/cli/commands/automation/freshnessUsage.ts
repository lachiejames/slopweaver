/** The usage leaf for `slopweaver automation freshness` — metadata only, so the manifest barrel can quote it. */

export const RECIPE_FRESHNESS_USAGE =
  "usage: slopweaver automation freshness [--json] [--home <dir>]\n" +
  "  How current each provider's stored data is — GitHub, Slack, Linear, Notion, Gmail, Calendar, Fathom —\n" +
  "  one row each: when its last VERIFIED resync succeeded, how far past its window that is, the newest\n" +
  "  record the store holds, and whether its sync is failing, blocked on you, paused or unscheduled, in the\n" +
  "  resync record's own words. The same judge the Fleet Briefing's freshness section uses, minus the atlas\n" +
  "  sweep, so the console can poll it on every page. A hand-run `refresh` does not advance the verified\n" +
  "  clock; a `automation resync` of that source does.\n" +
  "  READ-ONLY: no network, no model, nothing written. Exit 0 always — this is a report.\n" +
  "  --json      emit one machine-readable document instead of the lines\n" +
  "  --home      the state home to read, instead of $SLOPWEAVER_HOME";

export const RECIPE_FRESHNESS_FLAG_SPEC = {
  boolean: ["json"],
  string: ["home"],
} as const;
