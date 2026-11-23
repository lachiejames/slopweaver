/**
 * `slopweaver page publish`'s, `page review-prepare`'s, `page find`'s, `page read`'s, `page export`'s and `page tag`'s
 * usage lines, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/page.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

export const PAGE_PUBLISH_USAGE =
  "usage: slopweaver page publish <slug> --page <html> --review <id,...> [--assets-from <dir>] [--review-changed <what changed>] [--json] [--now <iso>] [--home <dir>]";

export const PAGE_REVIEW_PREPARE_USAGE =
  "usage: slopweaver page review-prepare <slug> --page <html> --inputs <file,...> [--json] [--home <dir>]";

export const PAGE_FIND_USAGE = "usage: slopweaver page find [<words>...] [--limit <n>] [--json] [--home <dir>]";

export const PAGE_TAG_USAGE =
  "usage: slopweaver page tag <slug> --meeting <event-id> [--calendar <id>] [--json] [--now <iso>] [--home <dir>]";

export const PAGE_READ_USAGE = "usage: slopweaver page read <slug> --presentation [--json] [--home <dir>]";

export const PAGE_EXPORT_USAGE = "usage: slopweaver page export <slug> --out <absolute-file> [--json] [--home <dir>]";
