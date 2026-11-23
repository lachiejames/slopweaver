/**
 * Whether the `named-object-params` gate's findings may be believed: the ending a scan takes, the Program
 * diagnostics that decide it, and the line printed when they say no. A type the checker could not resolve
 * becomes an error type, and an error type manufactures violations, so a finding over a file that does not
 * typecheck gets no verdict rather than a refusal.
 *
 * Split out of `./namedObjectParamsRun.ts` when TypeScript 7.1's diagnostic shape (a file NAME and a server
 * position in place of a source file and an offset) took that file past the code-line cap. This is the seam
 * its header already drew between the guards that decide whether a scan may be believed and the run that
 * prints the rest.
 */

import { relative } from "node:path";
import type * as ts from "#lib/tsCompiler.js";
import type { NamedObjectParamsViolation } from "./namedObjectParams.js";
import { diagnosticMessage } from "./namedObjectParamsProgram.js";

/**
 * Which ending the gate takes once the scan has run, and — the property this shape exists to make testable —
 * whether the Program's diagnostics had to be consulted to decide it.
 *
 * The diagnostics arrive as a THUNK rather than as a value because not calling it is the behaviour. They
 * answer one question: could a type the checker failed to resolve have manufactured this violation? That
 * question does not exist until there is a violation, so a clean scan never pays.
 *
 * The thunk is handed the distinct files that CARRY a finding, and asks about those files only. The
 * whole-repo `getSemanticDiagnostics()` it used to run sat on top of a ~6.4 GiB live set and took the
 * process past its 8,192 MiB ceiling, so every real violation surfaced in CI as a V8 heap FATAL naming
 * nothing — eight confirmed knowledge rows.
 *
 * Scoped, the check is bounded and NOT complete, and the residue is named rather than discovered: an
 * unresolved name or import in the violating file itself — the ordinary shape — is caught, but a type
 * imported through a re-export of a missing module resolves to an error type whose TS2307 lands in the
 * re-exporting file, so the violating file reads sound (reproduced on TypeScript 6.0.3 by the Codex plan
 * pass for this change). Widening to direct imports does not close it, since a two-hop chain defeats that
 * too, and the transitive closure converges on the whole Program this scoping exists to avoid. What the
 * residue can cost is bounded by direction: a wrongly believed finding is a false RED, printed with its
 * `path:line`, never a false clean — and whether the tree typechecks is `yarn typecheck`'s question, a
 * separate CI job over a separately scoped config, not this gate's. Pure, so the ordering and the scoping have a test rather than only a run.
 *
 * @param violations what the rule scan found
 * @param diagnosticsIfNeeded the blocking diagnostics for the files it is handed, evaluated only when there
 *   is a violation
 * @returns the ending, carrying whatever that ending has to print
 */
export function verdictAfterScan({
  violations,
  diagnosticsIfNeeded,
}: {
  violations: readonly NamedObjectParamsViolation[];
  diagnosticsIfNeeded: (scope: { readonly paths: readonly string[] }) => readonly string[];
}):
  | { readonly kind: "clean" }
  | { readonly kind: "untrustworthy"; readonly diagnostics: readonly string[] }
  | { readonly kind: "violations"; readonly violations: readonly NamedObjectParamsViolation[] } {
  if (violations.length === 0) {
    return { kind: "clean" };
  }
  const diagnostics = diagnosticsIfNeeded({ paths: [...new Set(violations.map((v) => v.path))] });
  if (diagnostics.length > 0) {
    return { diagnostics, kind: "untrustworthy" };
  }
  return { kind: "violations", violations };
}

/** The position a diagnostic about a whole file is reported at: its first line, zero-based as the server counts. */
const FILE_START = { character: 0, line: 0 } as const;

/**
 * Where a diagnostic points: `file:line`, or `(global)` when it carries no file at all.
 *
 * `startPosition = FILE_START` is a DESTRUCTURED DEFAULT, which is the spelling this repo's two gates agree on:
 * `??` is refused by `no-silent-fallback` and a ternary over the same absence is refused by oxlint's
 * `prefer-nullish-coalescing`, so the ternary-for-`??` swap is not a fix and the destructure is. What it
 * means is stated rather than implied: a diagnostic that carries a file but no position is about the FILE,
 * and line 1 is where this function chooses to report one.
 *
 * @param diagnostic the diagnostic to locate
 * @param root the repository root, so the path reads relative
 * @returns the location, ready to print
 */
function diagnosticLocation({ diagnostic, root }: { diagnostic: ts.Diagnostic; root: string }): string {
  const { fileName, startPosition = FILE_START } = diagnostic;
  if (fileName === undefined) {
    return "(global)";
  }
  return `${relative(root, fileName)}:${String(startPosition.line + 1)}`;
}

/**
 * Every diagnostic that would make a type-derived verdict about `paths` untrustworthy, as one-line messages.
 *
 * Scoped to the files carrying a finding, never the whole Program: see {@link verdictAfterScan} for why the
 * whole-repo pass cannot fit, and why these files are where an error type's own diagnostic lands. A path
 * the Program did not load is impossible here (the scan only reports loaded sources) and is reported
 * rather than skipped, because skipping it would read as a clean bill for a file nobody checked.
 *
 * @param program the Program the scan ran over
 * @param root the repository root, so locations read relative
 * @param paths the distinct files carrying a finding, as the Program names them
 * @returns the formatted diagnostics, empty when every one of those files is sound
 */
export function blockingDiagnostics({
  program,
  root,
  paths,
}: {
  program: ts.Program;
  root: string;
  paths: readonly string[];
}): readonly string[] {
  const loaded = new Set<string>(program.getSourceFileNames());
  const unloaded: string[] = [];
  const perFile: ts.Diagnostic[] = [];
  for (const path of paths) {
    if (!loaded.has(path)) {
      unloaded.push(`  ${relative(root, path)}: carries a finding but the Program has no source file for it`);
      continue;
    }
    for (const diagnostic of program.getSyntacticDiagnostics(path)) {
      perFile.push(diagnostic);
    }
    for (const diagnostic of program.getSemanticDiagnostics(path)) {
      perFile.push(diagnostic);
    }
  }
  return [
    ...unloaded,
    ...[...program.getConfigFileParsingDiagnostics(), ...program.getGlobalDiagnostics(), ...perFile].map(
      (d) =>
        `  TS${String(d.code)} ${diagnosticLocation({ diagnostic: d, root })}: ${diagnosticMessage({ diagnostic: d })}`,
    ),
  ];
}

/**
 * Report that the files carrying a finding do not typecheck, so the findings already printed above them
 * cannot be believed.
 *
 * Reached only from the violation path, and only after the run has named every finding — so a reader always
 * has the lines, and this says why they may be artefacts. A type the checker could not resolve becomes an
 * error type, and an error type manufactures violations, so the honest answer is no verdict rather than the
 * refusal a believed finding gets.
 *
 * @param diagnostics the compiler's own lines, already formatted
 * @param write the gate's stderr sink
 * @returns 1, the exit code a refused verdict gives
 */
export function reportUntrustworthyTypes({
  diagnostics,
  write,
}: {
  diagnostics: readonly string[];
  write: (text: string) => void;
}): number {
  // devlint: not-a-refusal -- the tree does not typecheck, so any violation this gate reported
  // could be an artefact of that; it gives no verdict rather than a clean one
  write(`named-object-params: the finding(s) above may be artefacts of ${String(diagnostics.length)} diagnostic(s):\n`);
  for (const line of diagnostics.slice(0, 20)) {
    // devlint: not-a-refusal -- a per-finding diagnostic: the compiler's own lines, verbatim
    write(`${line}\n`);
  }
  // devlint: not-a-refusal -- the tree does not typecheck, so any violation this gate reported
  // could be an artefact of that; it gives no verdict rather than a clean one
  write("a type this gate could not resolve produces FALSE violations, so no verdict is given.\n");
  return 1;
}
