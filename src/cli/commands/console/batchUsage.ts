/**
 * `slopweaver console batch`'s usage line, and nothing else — a LEAF, so the manifest that quotes it loads no command
 * module (`.claude/rules/area-cli.md` § "Metadata is eager, the run function is lazy"). Keep it importing nothing.
 */

/** `slopweaver console batch`'s usage line. */
export const CONSOLE_BATCH_USAGE =
  'usage: slopweaver console batch < argvs.json   (stdin: [["hand","list","--json"], ...])\n' +
  "  Run several verbs in THIS one process, in the order given, and print one JSON line per verb as each\n" +
  "  finishes: {index, exitCode, out, err, tookMs} — its whole stdout, the tail of its stderr. One Node boot\n" +
  "  and one module graph instead of one per verb. Only the console's own read verbs run (batchVerbs.ts);\n" +
  "  any other verb, an external-write one or a nested batch is refused, never run. It is not a job runner.";
