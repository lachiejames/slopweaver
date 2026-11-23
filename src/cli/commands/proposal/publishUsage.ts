/**
 * The usage text the destination-facing proposal verbs print (`publish`, `destination`, `drift`, `sync`), and
 * nothing else.
 *
 * A LEAF on purpose, like `./registerUsage.ts`: `cli/manifests/proposal.ts` reads these strings on EVERY
 * invocation, so they live apart from the command modules that would drag a publish's whole import graph onto
 * every unrelated verb's load path. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `proposal publish --help`. */
export const PUBLISH_USAGE: string =
  "usage: slopweaver proposal publish <path-to-draft.md> [--intake <id>] [--title <text>] " +
  "[--icon <emoji>] [--dry-run] [--json] [--home <dir>]\n" +
  "  Lint-gated publish to this install's destination (`proposal destination set`), through that\n" +
  "  destination's own door. REFUSES with no destination set, a document with a blocking finding, and\n" +
  "  while the named intake still has an unanswered blocking question.\n" +
  "  --intake         the intake this belongs to; its record remembers the page, so a re-publish keeps the URL\n" +
  "  --title          the proposal's title; required off Notion, where the page has no title property\n" +
  "  --icon           an emoji shown before the title\n" +
  "  --dry-run        lint, resolve the destination, and perform no effect";

/** `proposal destination --help`. */
export const DESTINATION_USAGE: string =
  "usage: slopweaver proposal destination set notion-page --parent <page-id-or-url> [--json] [--home <dir>]\n" +
  "       slopweaver proposal destination set local-page [--json] [--home <dir>]\n" +
  "       slopweaver proposal destination set linear-document --target-kind <project|initiative|issue|team> --target-id <id>\n" +
  "         [--json] [--home <dir>]\n" +
  "       slopweaver proposal destination show [--json] [--home <dir>]\n" +
  "  Where THIS install publishes a proposal, held in the state home rather than the code. `set` replaces it;\n" +
  "  `show` prints it, and exits non-zero when none is set — a status, naming the command that sets one.\n" +
  "  notion-page      each proposal is created under --parent and inherits that page's permissions\n" +
  "  local-page       each proposal is a local page under the state home's pages/; each publish names its title\n" +
  "  linear-document  each proposal is a Linear document under one project, initiative, issue or team\n" +
  "  --parent         the Notion page every new proposal is created under\n" +
  "  --target-kind    the kind of Linear entity every new proposal document belongs to\n" +
  "  --target-id      that Linear entity's id";

/** `proposal drift --help`. */
export const DRIFT_USAGE: string =
  "usage: slopweaver proposal drift [--slug <s>] [--json] [--home <dir>]\n" +
  "  Every tracked proposal whose newest MATERIAL event happened after its destination was last edited — a\n" +
  "  Notion page's last_edited_time, a Linear document's updatedAt, a local page's newest freeze. Reads each\n" +
  "  destination, writes nothing. Exits non-zero when anything is drifted or could not be assessed; a clean\n" +
  "  result is the ABSENCE of timestamp evidence, never proof the destination is right.\n" +
  "  --slug           only this proposal";

/** `proposal sync --help`. */
export const SYNC_USAGE: string =
  "usage: slopweaver proposal sync --source <notion-page-id-or-url>[,<id-or-url>,...] [--limit <1..100>] [--json] [--home <dir>]\n" +
  "  Discovers the child pages directly under each source and registers any not already tracked by page id.\n" +
  "  Discovery only: it never assigns a status, decision, successor, audience or Slack link — classify each\n" +
  "  new entry afterward with `status`/`decide`/`supersede`/`record-slack`/`follow-up`.\n" +
  "  --source         one or more Notion page ids or URLs, comma-separated\n" +
  "  --limit          top-level blocks requested per source (default 100, maximum 100)";
