/**
 * `slopweaver events tail`'s usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/events.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/** `slopweaver events tail`'s usage line. */
export const EVENTS_TAIL_USAGE =
  "usage: slopweaver events tail [--cursor <name>] [--since <byte-offset>] [--source <s>] [--kind <a,b>]\n" +
  "                             [--min-severity info|warn|alert] [--limit <n>] [--follow] [--deadline-ms <n>]\n" +
  "                             [--home <dir>] [--json]\n" +
  "  Read the supervisor stream — every state change the Slack listener, the recipe scheduler, the merge\n" +
  "  hold and `github attach`/`github merge` publish.\n" +
  "  Exits 3 when it printed an `alert` event or detected a gap; 0 when the stream was quiet.\n" +
  "  --cursor <name>       resume from this named cursor and advance it to what this run consumed. Lowercase\n" +
  "                        letters, digits and hyphens; each name is its own independent position.\n" +
  "  --since <offset>      start from this byte offset instead of the cursor's. The cursor still advances.\n" +
  "  --source <s>          one of the sources in docs/supervisor-events.md — `listener`,\n" +
  "                        `recipe-scheduler`, `github-attach`, `github-merge` or `github-hold`.\n" +
  "  --kind <a,b>          only these event kinds, comma-separated.\n" +
  "  --min-severity <s>    only events at or above this severity (default: info).\n" +
  "  --limit <n>           print at most n events. The cursor advances only past what was CONSUMED, so the\n" +
  "                        next run resumes at the first event this one did not reach.\n" +
  "  --follow              keep reading as the file grows, until interrupted or --deadline-ms elapses.\n" +
  "  --deadline-ms <n>     bound a --follow run. Without it, --follow runs until interrupted.";
