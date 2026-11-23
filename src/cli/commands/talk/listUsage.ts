/**
 * The usage lines of `talk list` and `talk list-add` — a leaf importing nothing, so the `talk` manifest can quote them
 * without loading a parser (`.claude/rules/area-cli.md`).
 */

/** The usage `talk list` prints. */
export const TALK_LIST_USAGE = "usage: slopweaver talk list [--since <seq>] [--voice-safe] [--home <dir>] [--json]";

/** The usage `talk list-add` prints. */
export const TALK_LIST_ADD_USAGE = [
  "usage: slopweaver talk list-add --origin owner|voice|fleet [--from <name>] [--label <words>] [--id <request-id>] [--fold-line <n>] [--home <dir>] [--json] < text",
  "       the item's text is read from stdin, exactly as piped; --from names the fleet session and only a fleet item takes it;",
  "       --fold-line is the line of the text its Show more starts on, counted from 1",
].join("\n");
