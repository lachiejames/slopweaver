/**
 * The `protect` noun's usage strings — a leaf the manifest barrel may import, so they live apart from the command.
 */

/** `protect add`. */
export const PROTECT_ADD_USAGE =
  'usage: slopweaver protect add <path> --mode read-only|no-access --why "<the owner\'s reason>" [--home <dir>]';

/** `protect remove`. */
export const PROTECT_REMOVE_USAGE = "usage: slopweaver protect remove <path> [--home <dir>]";

/** `protect list`. */
export const PROTECT_LIST_USAGE = "usage: slopweaver protect list [--json] [--home <dir>]";

/** `protect check`. */
export const PROTECT_CHECK_USAGE = "usage: slopweaver protect check <path> [--write] [--home <dir>]";
