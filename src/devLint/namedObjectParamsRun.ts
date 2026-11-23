/**
 * The effectful edge of the `named-object-params` gate: the Program it builds, the guards that decide
 * whether its scan may be believed, and the verdict it prints. The rule itself — the pure part — is
 * `./namedObjectParams.ts`, and the heap budget that watches what this costs is
 * `./namedObjectParamsHeap.ts`.
 *
 * Split out of `./namedObjectParams.ts` when that file crossed the code-line cap, which is the same seam
 * the file's own header always described ("pure `scanNamedObjectParams` + an effectful
 * `runNamedObjectParams` edge") and the same reason the heap half left before it. The Program it scans is
 * built in `./namedObjectParamsProgram.ts`, and whether a finding over it may be believed is
 * `./namedObjectParamsVerdict.ts`.
 *
 * The same edge has a second mode, the decision-stream run: named a subject checkout and a stream file
 * (`runNamedObjectParamsForSubject`), it judges that subject exactly as the gate judges this checkout and
 * writes every decision to the file (`./namedObjectParamsOracle.ts`). With neither variable set the gate run
 * is the only run, its output and cost unchanged.
 */

import { relative } from "node:path";
import type * as ts from "#lib/tsCompiler.js";
import { repoRootFromDirectory, repoRootOf } from "../lib/gitRepo.js";
import { reportScanIntegrity } from "../lib/textFileScan.js";
import { isScopedPath, type NamedObjectParamsViolation, scanCoverageGaps } from "./namedObjectParams.js";
import {
  fileMixLine,
  HEAP_BUDGET_MIB,
  heapBudgetReport,
  liveHeapMib,
  phaseReporter,
  phasesOn,
  reportOverBudget,
} from "./namedObjectParamsHeap.js";
import { discardDecisionStream, scanForRun } from "./namedObjectParamsOracle.js";
import { buildProgram, clearDecisionStream, readSubject } from "./namedObjectParamsProgram.js";
import { blockingDiagnostics, reportUntrustworthyTypes, verdictAfterScan } from "./namedObjectParamsVerdict.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/** Names the fixed subject tree a decision-stream run scans in place of this checkout. */
const SUBJECT_ROOT_ENV = "SLOPWEAVER_NAMED_OBJECT_PARAMS_SUBJECT_ROOT";

/** Names the file a decision-stream run writes its JSON Lines to, outside the subject. */
const DECISION_STREAM_ENV = "SLOPWEAVER_NAMED_OBJECT_PARAMS_DECISION_STREAM";

/**
 * Every reason to refuse a verdict that costs nothing to check: the scan's own coverage.
 *
 * The Program's diagnostics are deliberately NOT here. They are the expensive half — a semantic pass — and
 * {@link runOver} pays for them only where their answer is read, on the violation path, over
 * the violating files alone. What is left is decided from PATHS rather than from resolved types, and is
 * therefore free.
 *
 * @param root the repository root
 * @param sourceFiles the in-scope sources the Program loaded
 * @param listed the in-scope working-tree paths git reports
 * @param write the gate's stderr sink
 * @returns the exit code to return, or `undefined` when the scan covered what it claims
 */
function refuseUncoveredScan({
  root,
  sourceFiles,
  listed,
  write,
}: {
  root: string;
  sourceFiles: readonly ts.SourceFile[];
  listed: readonly string[];
  write: (text: string) => void;
}): number | undefined {
  const loaded = sourceFiles.map((sf) => relative(root, sf.fileName));
  const { missing, unlisted } = scanCoverageGaps({ loaded, listed });
  if (missing.length > 0 || unlisted.length > 0) {
    // devlint: not-a-refusal -- a scan-integrity fact: what was read does not match what was claimed, so no verdict is given
    write("named-object-params: the scan did not cover what it claims:\n");
    for (const path of missing) {
      write(`  ${path}  (in the working tree + in scope, but the Program never loaded it)\n`);
    }
    for (const path of unlisted) {
      write(`  ${path}  (loaded by the Program, but git does not report it — ignored, or outside the checkout)\n`);
    }
    return 1;
  }
  const complete = reportScanIntegrity({
    label: "named-object-params",
    scanned: sourceFiles.length,
    unreadable: [],
    write,
  });
  return complete ? undefined : 1;
}

/** The sentence that tells an author what one finding means and what to do about it. */
function ruleText({ rule }: { rule: NamedObjectParamsViolation["rule"] }): string {
  switch (rule) {
    case "arity":
      return "more than one parameter";
    case "not-an-options-object":
      return "sole parameter is not an options object";
    case "redundant-marker":
      return "exempts nothing: the signature below is already compliant or exempt by construction — delete the marker";
    default: {
      const unreachable: never = rule;
      return unreachable;
    }
  }
}

/**
 * Print each finding's line and what it means, the moment the scan has produced them.
 *
 * Deliberately BEFORE any diagnostics pass and separate from the refusal that follows: whatever that pass
 * costs, or however it ends, the lines are already on stderr. The verdict on them — believed, or possibly
 * an artefact — is printed after, by whichever ending applies.
 *
 * @param root the repository root, so paths report repo-relative
 * @param violations the offending signatures
 * @param write the gate's stderr sink
 */
function reportFindings({
  root,
  violations,
  write,
}: {
  root: string;
  violations: readonly NamedObjectParamsViolation[];
  write: (text: string) => void;
}): void {
  for (const violation of violations) {
    write(`  ${relative(root, violation.path)}:${String(violation.line)}: ${violation.name}${violation.signature}\n`);
    write(`      ${ruleText({ rule: violation.rule })}\n`);
  }
}

/**
 * The Program and the in-scope sources it loaded, or the exit code to give instead.
 *
 * Split from {@link runOver} to keep that body under the function cap; the phase sink is
 * passed in rather than created here so both halves report against the same run.
 *
 * @param root the repository root
 * @param phase the phase sink, which reports the heap after `createProgram`
 * @param write the gate's stderr sink
 * @returns the loaded Program and its in-scope sources, or the exit code a failed load gives
 */
function loadScan({
  root,
  phase,
  write,
}: {
  root: string;
  phase: (label: string) => void;
  write: (text: string) => void;
}): { readonly failure: number } | { readonly program: ts.Program; readonly sourceFiles: readonly ts.SourceFile[] } {
  const built = buildProgram({ root });
  if ("failure" in built) {
    // devlint: not-a-refusal -- no Program could be built, so this gate has no verdict rather than a clean one
    write(`named-object-params: could not build a Program — ${built.failure}\n`);
    return { failure: 1 };
  }
  const { program } = built;
  phase("createProgram");
  // Declaration files under the scoped prefixes are NOT filtered out, and that is load-bearing rather than
  // incidental. `isScopedPath` accepts any `.ts`, so a `.d.ts` is in scope; excluding it here — as a
  // first cut did — made the two sides disagree, and a gitignored `src/injected.d.ts` then slipped through the
  // unlisted check entirely while the gate still printed `clean`. A hand-written declaration in this repo is
  // a signature authored here, so governing it is also the right answer on the merits. Vendored declarations
  // never reach this filter: they live outside `src/`, `eval/` and `hooks/`. Only an in-scope file's tree is
  // fetched from the server; a dependency's stays there.
  const loaded = program.getSourceFileNames();
  const sourceFiles: ts.SourceFile[] = [];
  for (const fileName of loaded.filter((name) => isScopedPath({ path: relative(root, name) }))) {
    const sourceFile = program.getSourceFile(fileName);
    if (sourceFile === undefined) {
      // devlint: not-a-refusal -- a scan-integrity fact: the Program names a file it then cannot serve
      write(`named-object-params: the Program lists ${relative(root, fileName)} but has no source file for it\n`);
      return { failure: 1 };
    }
    sourceFiles.push(sourceFile);
  }
  if (phasesOn()) {
    process.stdout.write(`${fileMixLine({ inScope: sourceFiles, loaded })}\n`);
  }
  return { program, sourceFiles };
}

/**
 * Decide and print the verdict on the findings the scan already named, paying for the semantic pass only on
 * the violation path and only over the violating files ({@link verdictAfterScan}).
 *
 * Split from {@link runOver} to keep that body under the function cap.
 *
 * @param decisionStreamPath the stream the scan wrote, discarded when the types under it cannot be believed
 * @param program the Program the scan ran over
 * @param root the repository root, so locations read relative
 * @param violations what the rule scan found, already printed by {@link reportFindings}
 * @param phase the phase sink, which reports the heap after the semantic pass
 * @param write the gate's stderr sink
 * @returns 1 when the findings are refused or cannot be believed, `undefined` when the scan was clean
 */
function refuseFindings({
  decisionStreamPath,
  program,
  root,
  violations,
  phase,
  write,
}: {
  decisionStreamPath?: string | undefined;
  program: ts.Program;
  root: string;
  violations: readonly NamedObjectParamsViolation[];
  phase: (label: string) => void;
  write: (text: string) => void;
}): number | undefined {
  const verdict = verdictAfterScan({
    diagnosticsIfNeeded: ({ paths }) => {
      const diagnostics = blockingDiagnostics({ paths, program, root });
      phase("semantic pass (violating files)");
      return diagnostics;
    },
    violations,
  });
  if (verdict.kind === "untrustworthy") {
    discardDecisionStream({ decisionStreamPath });
    return reportUntrustworthyTypes({ diagnostics: verdict.diagnostics, write });
  }
  if (verdict.kind === "violations") {
    write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "named-object-params" }),
        detail: `${String(verdict.violations.length)} finding(s) break the rule`,
      })}\n`,
    );
    return 1;
  }
  return undefined;
}

/**
 * The run itself, over whichever checkout `resolveRoot` names: build the Program, check the scan covers what
 * it claims, run the rule (writing the decision stream when one is named), print the verdict. The gate run
 * and the subject run differ ONLY in that root and that stream.
 *
 * @param decisionStreamPath where the decision stream goes; absent in the gate run
 * @param resolveRoot the checkout to scan, resolved inside the git guard so a failure is reported, not thrown
 * @param subjectDir the directory a subject run named, which a stream is cleared against when no root resolves
 * @returns the process exit code
 */
function runOver({
  decisionStreamPath,
  resolveRoot,
  subjectDir,
}: {
  decisionStreamPath?: string | undefined;
  resolveRoot: () => string;
  subjectDir?: string | undefined;
}): number {
  // Annotated so the arrow INHERITS `reportScanIntegrity`'s `write` seam rather than restating it — the same
  // shape that seam already dictates, and the gate below would (correctly) report a restated one.
  const write: (text: string) => void = (text) => {
    process.stderr.write(text);
  };
  const subject = readSubject({ decisionStreamPath, resolveRoot, subjectDir, write });
  if (subject === undefined) {
    return 1;
  }
  const { listed, root } = subject;
  const phase = phaseReporter();
  const scan = loadScan({ root, phase, write });
  if ("failure" in scan) {
    return scan.failure;
  }
  const { program, sourceFiles } = scan;
  const refusal = refuseUncoveredScan({ root, sourceFiles, listed, write });
  if (refusal !== undefined) {
    return refusal;
  }
  // The scan is its own statement, and `phase("rule scan")` sits directly under it, because on the
  // VIOLATION path `verdictAfterScan` runs the semantic pass inside itself — so a "rule scan" line
  // reported after that call would be labelling the semantic pass's heap as the rule's.
  const violations = scanForRun({
    checker: program.getProject().checker,
    decisionStreamPath,
    root,
    sourceFiles,
    write,
  });
  if (violations === undefined) {
    return 1;
  }
  // Named first, before even the phase mark (which forces a major GC), so no later cost can swallow them:
  // the whole-repo pass that used to follow died at the heap ceiling before a single line printed.
  reportFindings({ root, violations, write });
  phase("rule scan");
  const refused = refuseFindings({ decisionStreamPath, phase, program, root, violations, write });
  if (refused !== undefined) {
    return refused;
  }
  // Measured HERE, at the gate's high-water mark: the Program is loaded and the scan has walked every
  // source. Anything earlier reports a number the gate has already exceeded.
  const heap = heapBudgetReport({ budgetMib: HEAP_BUDGET_MIB, liveMib: liveHeapMib() });
  process.stdout.write(`named-object-params: clean (${String(sourceFiles.length)} sources scanned, ${heap.line})\n`);
  if (heap.overBudget) {
    return reportOverBudget({ heap, write });
  }
  return 0;
}

/**
 * Run the rule over a FIXED SUBJECT TREE rather than this checkout, writing every decision to
 * `decisionStreamPath` (`./namedObjectParamsOracle.ts`). The subject is resolved to its git root and judged
 * exactly as the gate judges this checkout — its own lint config, its own `node_modules`, its own coverage
 * against its own git — so two implementations of the rule run over one subject differ only in the rule.
 *
 * @param decisionStreamPath the JSON Lines file to write, outside the subject
 * @param subjectRoot a directory inside the subject checkout
 * @returns the process exit code, the gate's own
 */
export function runNamedObjectParamsForSubject({
  decisionStreamPath,
  subjectRoot,
}: {
  decisionStreamPath: string;
  subjectRoot: string;
}): number {
  return runOver({
    decisionStreamPath,
    resolveRoot: () => repoRootFromDirectory({ dir: subjectRoot }),
    subjectDir: subjectRoot,
  });
}

/**
 * IO edge: build the Program, check the scan covers what it claims, run the rule, print the verdict.
 *
 * Fail-closed in four ways beyond finding a violation, because this gate derives its verdict from RESOLVED
 * TYPES and every one of these makes those types a lie rather than an answer:
 *
 * - an in-scope working-tree file the Program never loaded — unscanned, so any `clean` would cover it falsely;
 * - an in-scope file the Program loaded that git does not report — the scan is not reproducible from the tree;
 * - zero sources — a broken path filter reads identically to a clean tree;
 * - a config, global or compile diagnostic in a file carrying a finding, on the violation path only — an
 *   unresolved import turns an imported type into an error type, whose properties the checker reports as
 *   none, which would manufacture violations wholesale. It cannot manufacture a CLEAN one, which is why
 *   {@link verdictAfterScan} decides when to ask, and asks only about those files.
 *
 * With BOTH `SLOPWEAVER_NAMED_OBJECT_PARAMS_SUBJECT_ROOT` and `SLOPWEAVER_NAMED_OBJECT_PARAMS_DECISION_STREAM`
 * set it is {@link runNamedObjectParamsForSubject} instead; with only one, or either empty, it refuses before
 * building anything, because half a subject run would silently be a gate run over the wrong tree — and clears
 * a named stream path, so an earlier run's file does not pass for this one's output.
 *
 * @returns the process exit code (0 clean, 1 a violation, a coverage gap, a diagnostic, or not a git checkout)
 */
export function runNamedObjectParams(): number {
  const subjectRoot = process.env[SUBJECT_ROOT_ENV];
  const decisionStreamPath = process.env[DECISION_STREAM_ENV];
  if (subjectRoot === undefined && decisionStreamPath === undefined) {
    return runOver({ resolveRoot: () => repoRootOf({ importMetaUrl: import.meta.url }) });
  }
  if (
    subjectRoot === undefined ||
    subjectRoot === "" ||
    decisionStreamPath === undefined ||
    decisionStreamPath === ""
  ) {
    const write: (text: string) => void = (text) => {
      process.stderr.write(text);
    };
    // devlint: not-a-refusal -- a usage fact: a subject run needs both variables, and the gate run needs neither
    write(
      `named-object-params: a decision-stream run needs both ${SUBJECT_ROOT_ENV} and ${DECISION_STREAM_ENV}, non-empty\n`,
    );
    if (decisionStreamPath !== undefined && decisionStreamPath !== "") {
      // No subject was named, so nothing the path could belong to: an earlier run's stream goes, as on any failure.
      clearDecisionStream({ decisionStreamPath, write });
    }
    return 1;
  }
  return runNamedObjectParamsForSubject({ decisionStreamPath, subjectRoot });
}
