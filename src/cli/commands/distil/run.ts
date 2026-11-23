/**
 * `slopweaver distil` — the bare noun. An ALIAS of `distil brief`, not a fourth behaviour.
 *
 * Kept as its own thin file (rather than folding into `brief.ts`) only because the bare noun and `distil
 * brief` consume a DIFFERENT argv offset: `slopweaver distil --home x` has no verb word to skip, `distil
 * brief --home x` does. The two entry points share `brief.ts`'s body and differ only in how much of argv
 * they hand it, which is why folding them together would mean a runtime guess at which spelling was used.
 */
import { defineCommand } from "../../defineCommand.js";
import { runDistilBriefWithRest } from "./brief.js";

/**
 * Run the bare `distil` noun.
 *
 * @param argv the full process argv (verb tail starts at index 3: `[node, cli, distil, …]`)
 * @returns the process exit code
 */
export function runDistil(argv: readonly string[]): number {
  return runDistilBriefWithRest({ rest: argv.slice(3) });
}

export const distilRunCommand = defineCommand({ run: runDistil });
