/**
 * The `ruling` noun's usage strings — a leaf the manifest barrel may import, so they live apart from the command.
 */

/** `ruling record`. */
export const RULING_RECORD_USAGE =
  'usage: slopweaver ruling record --category <slug> --words "<the owner\'s words>" --decided-on <YYYY-MM-DD> ' +
  '[--anchor <where it was said>] [--context "<the occasion>"] [--replaces <id>]... [--alongside] [--new-category] ' +
  "[--json] [--home <dir>]";

/** `ruling list`. */
export const RULING_LIST_USAGE = "usage: slopweaver ruling list [--category <slug>] [--all] [--json] [--home <dir>]";

/** `ruling seed`. */
export const RULING_SEED_USAGE =
  "usage: slopweaver ruling seed --from <state doc> [--from <archive>]... (--plan | --decisions <file.jsonl> --apply) " +
  "[--home <dir>]";

/** `ruling view`. */
export const RULING_VIEW_USAGE = "usage: slopweaver ruling view [--home <dir>]";
