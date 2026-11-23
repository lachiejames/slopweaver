/**
 * `slopweaver briefing recut --form <path> --out <path>` — rewrite the fleet words in a form's authored prose
 * into plain ones, and list every fleet word it left for a composer. The decision is
 * `../../../briefing/recut.ts`, and the substitutions are `../../../briefing/fleetJargon.ts`'s.
 */
import { type RecutResult, recutForm } from "../../../briefing/recut.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { parseBriefingRecutArgs } from "./formEditArgs.js";
import {
  type BriefingFormEditDeps,
  formJsonText,
  productionFormEditDeps,
  readFormJson,
  runFormEdit,
  writeFormText,
} from "./formEditIo.js";
import { BRIEFING_RECUT_USAGE } from "./usage.js";

/**
 * Run `briefing recut` against injected seams.
 *
 * A word it could not rewrite is REPORTED and the exit is still ok: the rewrite it could do is written, and
 * `briefing render` is what refuses a page that still carries an unglossed word.
 *
 * @param rest the argv tail after `briefing recut`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runBriefingRecut({ rest, deps }: { rest: readonly string[]; deps: BriefingFormEditDeps }): number {
  const args = parseBriefingRecutArgs({ rest });
  if (args.isErr()) {
    for (const line of args.error) {
      deps.writeDiagnostic(`briefing recut: ${line}`);
    }
    deps.writeDiagnostic(BRIEFING_RECUT_USAGE);
    return EXIT_USAGE;
  }
  const { formPath, out, dryRun } = args.value;
  const form = readFormJson({ deps, path: formPath });
  if (form.isErr()) {
    deps.writeDiagnostic(`briefing recut: ${form.error.message}`);
    return EXIT_ERROR;
  }
  const edited = runFormEdit({ edit: recutForm, form: form.value, path: formPath });
  if (edited.isErr()) {
    deps.writeDiagnostic(`briefing recut: ${edited.error.message}; nothing was written to ${out}`);
    return EXIT_ERROR;
  }
  const result = edited.value;
  const { tally, leftovers } = recutReport({ result });
  if (dryRun) {
    deps.writeOut(`briefing recut: would make ${tally} (dry run, nothing written)`);
    for (const line of leftovers) {
      deps.writeOut(line);
    }
    return EXIT_OK;
  }
  const text = formJsonText({ form: result.form });
  if (text.isErr()) {
    deps.writeDiagnostic(`briefing recut: ${text.error.message}; nothing was written to ${out}`);
    return EXIT_ERROR;
  }
  const written = writeFormText({ deps, path: out, text: text.value });
  if (written.isErr()) {
    deps.writeDiagnostic(`briefing recut: ${written.error.message}`);
    return EXIT_ERROR;
  }
  deps.writeOut(`briefing recut: ${tally}; wrote ${out}`);
  for (const line of leftovers) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * What one recut pass says: the substitution tally, and one line per word left for a composer.
 *
 * @param result the pass's own counts and leftovers
 * @returns the tally phrase, and the leftover lines in the order they were found
 */
function recutReport({ result }: { result: RecutResult }): { tally: string; leftovers: readonly string[] } {
  const terms = Object.entries(result.counts).toSorted(([left], [right]) => left.localeCompare(right));
  const total = terms.reduce((sum, [, count]) => sum + count, 0);
  const perTerm = terms.map(([term, count]) => `${term} ${String(count)}`).join(", ");
  const suffix = total === 0 ? "" : ` (${perTerm})`;
  return {
    leftovers: result.leftovers.map((left) => `  left for a composer: ${left.path} uses "${left.used}" (${left.term})`),
    tally: `${String(total)} substitution(s)${suffix}`,
  };
}

/** `slopweaver briefing recut`. */
export const briefingRecutCommand = defineCommand({
  run: (argv) => runBriefingRecut({ deps: productionFormEditDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
