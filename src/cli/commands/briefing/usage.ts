/**
 * The usage lines of every `slopweaver briefing` verb, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/briefing.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

export const BRIEFING_ARCHIVE_USAGE =
  "usage: slopweaver briefing archive --form <path> [--keep-notes <n>] [--keep-sections <n>] [--out <path>] [--oldest-first] [--dry-run]";

/** `slopweaver briefing check`'s usage line. */
export const BRIEFING_CHECK_USAGE = "usage: slopweaver briefing check <html> [--home <path>]";

/** `slopweaver briefing corrections`'s usage line. */
export const BRIEFING_CORRECTIONS_USAGE =
  "usage: slopweaver briefing corrections --page <html> [--artifact <url|id>] [--previous <html>] [--out <html>] [--verify] [--json] [--home <path>]";

/** `slopweaver briefing freeze`'s usage line. */
export const BRIEFING_FREEZE_USAGE =
  "usage: slopweaver briefing freeze --artifact <url|id> --page <html> [--new] [--json] [--home <path>]";

/** `slopweaver briefing render`'s usage line. */
export const BRIEFING_RENDER_USAGE =
  "usage: slopweaver briefing render --form <json|-> [--your-list <path|->] [--open-prs] [--open-artifacts <path|->] [--open-page-cards] [--freshness] [--nothing-stale] [--autonomy-ledger] [--owner-beliefs] [--hand-steps] [--knowledge-quiz --sweep <tick-id>] [--ticks <path|-> [--ticks-days <n>]] [--top <n>] [--out <html>] [--home <path>]";

/** `slopweaver briefing sweep-block`'s usage line. */
export const BRIEFING_SWEEP_BLOCK_USAGE =
  "usage: slopweaver briefing sweep-block --form <path> --workspace <ws> --handoff <name> --model <model> " +
  "--pinned-at <iso> --sleeping <true|false> --alignment <text> --headline-sentence <text>... " +
  "--fold <text> --fold-summary <text> [--lede <text>] [--alignment-detail <text>] [--alignment-summary <text>] " +
  "[--intake <text>] [--drop-card-prefix <text>] [--keep-recent <n>] [--earlier-summary <text>] [--dry-run]";

/** `slopweaver briefing fold-caps`'s usage line. */
export const BRIEFING_FOLD_CAPS_USAGE = "usage: slopweaver briefing fold-caps --form <path> [--dry-run]";

/** `slopweaver briefing card`'s usage line. */
export const BRIEFING_CARD_USAGE =
  "usage: slopweaver briefing card --open-pages <path> (--row <path|-> [--replace] | --drop <url> [--settled-by <slug>]) [--dry-run] [--json] [--home <dir>]\n" +
  "\n" +
  "--row holds ONE open-pages row — label, url, ask, landedIso and the six card fields, with an optional detail\n" +
  "fold — to every gate the rendered page applies to a projected card (the index schema, the local-copy rule,\n" +
  "every word and sentence cap, the framing and voice rules), then appends it to <open-pages> atomically.\n" +
  "Refuses, writing nothing, on any defect, on a url a row already names (--replace swaps that row in place), on\n" +
  "a page the owner's ruling already settled, and on a document the render would refuse. Unknown keys pass through.\n" +
  "\n" +
  "--drop removes the ONE row naming <url> exactly, every other row untouched, when the owner's lock-in ruling on the\n" +
  "page decided it (approved, edited, rejected or dropped; noted and deferred do not) or when the board row\n" +
  "--settled-by names publishes that url and is settled, terminal or ruled. Refuses, writing nothing, otherwise.\n" +
  "\n" +
  "example: slopweaver briefing card --open-pages ./scratchpad/open-pages.json --row ./scratchpad/row.json\n" +
  "example: slopweaver briefing card --open-pages ./scratchpad/open-pages.json --drop <url> --dry-run";

/** `slopweaver briefing recut`'s usage line. */
export const BRIEFING_RECUT_USAGE = "usage: slopweaver briefing recut --form <path> --out <path> [--dry-run]";
