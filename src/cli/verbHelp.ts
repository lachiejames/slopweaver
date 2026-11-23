/**
 * `--help` support at the dispatch boundary.
 *
 * A manifest verb carries a `meta.usage` string readable WITHOUT loading its module (see manifest.ts),
 * so the dispatcher answers a help request itself — print the verb's usage, exit 0 — before ever
 * calling the handler. That saves every verb from hand-rolling `--help` and saves the round-trip an
 * agent or human spends probing an unfamiliar verb. Pure: no I/O, no clock; index.ts sends the rendered
 * string to stdout (help is data, not a diagnostic).
 */
import type { CommandMeta } from "./defineCommand.js";

/**
 * Whether `argv` (full process argv: [node, cli, noun, ...]) is a help request: `--help` or `-h` anywhere
 * from argv[3] onward. Exact-match so a flag like `--help-text` never trips it.
 *
 * argv[3] is deliberately included rather than skipped as "the verb": a noun with a default verb (`doctor`,
 * `profile`, `distil` and the rest that register `DEFAULT_VERB`) routes `slopweaver doctor --help` with the
 * flag AT argv[3], so starting at argv[4] would run the default verb instead of answering help.
 *
 * @param argv the full process argv
 * @returns true when the tail requests help
 */
export function wantsHelp({ argv }: { argv: readonly string[] }): boolean {
  return argv.slice(3).some((arg) => arg === "--help" || arg === "-h");
}

/**
 * Render a verb's help block from its metadata: summary, the usage line, and the example when present.
 *
 * @param meta the verb's command metadata
 * @returns the rendered help block
 */
export function renderVerbHelp({ meta }: { meta: CommandMeta }): string {
  const lines = [meta.summary, meta.usage];
  if (meta.example !== null) {
    lines.push("", `example: ${meta.example}`);
  }
  return lines.join("\n");
}
