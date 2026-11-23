/**
 * The `witness` noun's usage lines — a metadata LEAF the manifest quotes and the commands import back, so the
 * manifest barrel stays free of any command module (`manifestBarrelClosure.test.ts`). Imports nothing.
 *
 * Every flag named here is one `./args.ts` accepts, and every flag it accepts is named here; the help-truth
 * ratchet (`helpTruth.test.ts`) fails the moment the two disagree.
 */

/** `witness dispatch`. */
export const WITNESS_DISPATCH_USAGE =
  "usage: slopweaver witness dispatch --channel <id> --thread-ts <ts> --message-ts <ts> --text <text> " +
  "--model <sonnet|opus|...> [--home <dir>] [--json]";

/** `witness resume`. */
export const WITNESS_RESUME_USAGE = "usage: slopweaver witness resume <witness-id> [--home <dir>]";

/** `witness settle`. */
export const WITNESS_SETTLE_USAGE =
  "usage: slopweaver witness settle (<witness-id> | --channel <id> --thread-ts <ts> --message-ts <ts>) " +
  "--as <nothing-checkable|nothing-material|posted|failed> [--why <text>] [--posted-ts <ts>] [--home <dir>] [--json]";

/** `witness help`. */
export const WITNESS_HELP_USAGE =
  "usage: slopweaver witness help --channel <id> --thread-ts <ts> --message-ts <ts> --user <id> --text <text> " +
  "[--home <dir>]";

/** `witness stand-down`. */
export const WITNESS_STAND_DOWN_USAGE =
  "usage: slopweaver witness stand-down --channel <id> --thread-ts <ts> [--message-ts <ts>] --why <what was said> " +
  "[--home <dir>]\n" +
  "  with --message-ts: react on that message, then journal the stand-down\n" +
  "  without it: stand the whole thread down, reacting on nothing (the message already ended, is gone, or the word came off Slack)";

/** `witness revise`. */
export const WITNESS_REVISE_USAGE =
  'usage: slopweaver witness revise <witness-id> --wrong "<exact words>" --correction "<line>" ' +
  "--because <permalink> [--dry-run] [--home <dir>]";

/** `witness list`. */
export const WITNESS_LIST_USAGE = "usage: slopweaver witness list [--home <dir>] [--json]";
