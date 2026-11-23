/**
 * `slopweaver briefing fold-caps --form <path>` — bring every composed fold in a form's narrative sections back
 * under the four-block cap without changing a word. The decision is `../../../briefing/foldCaps.ts`; this edge
 * reads the form, refuses to write a partial repair, and says what moved.
 */
import { FOLD_MAX_BLOCKS } from "../../../briefing/caps.js";
import { type FoldReshape, reshapeFormFolds } from "../../../briefing/foldCaps.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { parseBriefingFoldCapsArgs } from "./formEditArgs.js";
import {
  type BriefingFormEditDeps,
  formJsonText,
  productionFormEditDeps,
  readFormJson,
  runFormEdit,
  writeFormText,
} from "./formEditIo.js";
import { BRIEFING_FOLD_CAPS_USAGE } from "./usage.js";

/**
 * Run `briefing fold-caps` against injected seams.
 *
 * @param rest the argv tail after `briefing fold-caps`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code: usage for a bad invocation, error when a fold cannot be reshaped, ok otherwise
 */
export function runBriefingFoldCaps({ rest, deps }: { rest: readonly string[]; deps: BriefingFormEditDeps }): number {
  const args = parseBriefingFoldCapsArgs({ rest });
  if (args.isErr()) {
    for (const line of args.error) {
      deps.writeDiagnostic(`briefing fold-caps: ${line}`);
    }
    deps.writeDiagnostic(BRIEFING_FOLD_CAPS_USAGE);
    return EXIT_USAGE;
  }
  const { formPath, dryRun } = args.value;
  const form = readFormJson({ deps, path: formPath });
  if (form.isErr()) {
    deps.writeDiagnostic(`briefing fold-caps: ${form.error.message}`);
    return EXIT_ERROR;
  }
  const edited = runFormEdit({ edit: reshapeFormFolds, form: form.value, path: formPath });
  if (edited.isErr()) {
    deps.writeDiagnostic(`briefing fold-caps: ${edited.error.message}; nothing was written to ${formPath}`);
    return EXIT_ERROR;
  }
  const result = edited.value;
  if (result.unshapeable.length > 0) {
    refuseUnshapeable({ deps, formPath, unshapeable: result.unshapeable });
    return EXIT_ERROR;
  }
  if (result.reshaped.length === 0) {
    deps.writeOut(
      `briefing fold-caps: every fold is within ${String(FOLD_MAX_BLOCKS)} blocks; ${formPath} is unchanged`,
    );
    return EXIT_OK;
  }
  if (dryRun) {
    report({
      deps,
      headline: `briefing fold-caps: ${String(result.reshaped.length)} fold(s) would be reshaped (dry run, nothing written)`,
      reshaped: result.reshaped,
    });
    return EXIT_OK;
  }
  const text = formJsonText({ form: result.form });
  if (text.isErr()) {
    deps.writeDiagnostic(`briefing fold-caps: ${text.error.message}; nothing was written to ${formPath}`);
    return EXIT_ERROR;
  }
  const written = writeFormText({ deps, path: formPath, text: text.value });
  if (written.isErr()) {
    deps.writeDiagnostic(`briefing fold-caps: ${written.error.message}`);
    return EXIT_ERROR;
  }
  report({
    deps,
    headline: `briefing fold-caps: reshaped ${String(result.reshaped.length)} fold(s); wrote ${formPath}`,
    reshaped: result.reshaped,
  });
  return EXIT_OK;
}

/**
 * Print the headline, then one line per fold that changed shape.
 *
 * @param deps the injected output lane
 * @param headline the first line, which says whether anything was written
 * @param reshaped the folds that were brought under the cap
 */
function report({
  deps,
  headline,
  reshaped,
}: {
  deps: BriefingFormEditDeps;
  headline: string;
  reshaped: readonly FoldReshape[];
}): void {
  deps.writeOut(headline);
  for (const fold of reshaped) {
    deps.writeOut(`  ${fold.path}: ${String(fold.before)} blocks -> ${String(fold.after)}`);
  }
}

/**
 * Say which folds could not be reshaped without changing what they mean, and that nothing was written.
 *
 * @param deps the injected diagnostic lane
 * @param formPath the form left untouched
 * @param unshapeable every fold still over the cap
 */
function refuseUnshapeable({
  deps,
  formPath,
  unshapeable,
}: {
  deps: BriefingFormEditDeps;
  formPath: string;
  unshapeable: readonly FoldReshape[];
}): void {
  for (const fold of unshapeable) {
    deps.writeDiagnostic(
      `briefing fold-caps: ${fold.path} still carries ${String(fold.after)} blocks after joining its adjacent ` +
        `paragraphs and lists, over the cap of ${String(FOLD_MAX_BLOCKS)} — move a block into a nested fold by hand`,
    );
  }
  deps.writeDiagnostic(`briefing fold-caps: nothing was written to ${formPath}`);
}

/** `slopweaver briefing fold-caps`. */
export const briefingFoldCapsCommand = defineCommand({
  run: (argv) => runBriefingFoldCaps({ deps: productionFormEditDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
