/**
 * The heap-budget half of the `named-object-params` gate: the budget and its measurement history, the live
 * heap reading behind it, the phase report, the advice it prints, and the refusal beneath it.
 *
 * Split out of `./namedObjectParams.ts` when that file crossed the code-line cap — the gate's own
 * `file-size-ratchet` sibling said so, which is the shape working — and the measurement moved here with it
 * the next time the cap fell, so the number and the instrument that re-measures it read together. The advice
 * is long on purpose: it is the one gate whose failure is usually nobody's code defect, so it has to say
 * that first and loudly.
 */

import v8 from "node:v8";
import type * as ts from "#lib/tsCompiler.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * What to say when the requirement outgrows the budget.
 *
 * It opens by clearing the reader, because the failure is repo growth and the reader is whoever's diff
 * happened to be in flight when the tripwire fired. It then closes the one move it used to recommend: the
 * budget went from 2,200 to 6,543 MiB over about thirty-five raises, most riding unrelated pull requests, and
 * the owner learned of it only by asking. A session never raises it. It cuts what the gate holds,
 * and a requirement still past the budget is the owner's decision, on a Queue card carrying the measurement.
 */
const OVER_BUDGET_ADVICE =
  `named-object-params: NOTHING IN YOUR DIFF BROKE A RULE — the scan is clean. This gate holds a\n` +
  `whole-repo ts.Program, so its heap requirement tracks REPO GROWTH, and the repository has grown\n` +
  `past the budget. That is the failure, and it is nobody's code defect.\n` +
  `HEAP_BUDGET_MIB is NEVER raised by a session. Measure where the heap goes:\n` +
  `  SLOPWEAVER_HEAP_PHASES=1 yarn tsx --expose-gc --max-old-space-size=8192 src/devLint/namedObjectParams.entry.ts\n` +
  `(\`slopweaver dev profile --gate named-object-params --cpu\` adds where the TIME goes), then cut what\n` +
  `the gate holds or resolves — HEAP_BUDGET_MIB's comment in src/devLint/namedObjectParamsHeap.ts names\n` +
  `what has been cut and what was measured and rejected. If nothing more can be cut, put a Queue card to\n` +
  `the owner with that measurement and let the owner decide the budget.\n`;

/**
 * Report the heap budget being exceeded: the long-form advice, then the four-line refusal.
 *
 * Split out so {@link runNamedObjectParams} stays under the body cap. The advice and the refusal are both
 * kept: the advice carries the exact command, and the refusal carries the shape every gate now ends in.
 *
 * @param heap the measured budget report
 * @param write the gate's stderr sink
 * @returns 1, the exit code an over-budget run gives
 */
export function reportOverBudget({
  heap,
  write,
}: {
  heap: { readonly line: string; readonly overBudget: boolean };
  write: (text: string) => void;
}): number {
  // devlint: not-a-refusal -- a correction body: the exact measuring command and where the cuts are recorded,
  // which the refusal's own correction line summarises in one sentence
  write(OVER_BUDGET_ADVICE);
  write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "named-object-params-heap" }),
      detail: heap.line,
    })}\n`,
  );
  return 1;
}

/**
 * The live heap this gate is allowed to need, in MiB. **A session never raises it** — a budget raised
 * without the owner knowing is a problem the owner needs to know about. Over budget, cut what the gate holds
 * or resolves; a requirement still past it is a Queue card to the owner with the measurement, and the number
 * is the owner's to move.
 *
 * ## What it measures, and why it is a tripwire under a ceiling
 *
 * The live set after a forced major GC ({@link liveHeapMib}), not peak RSS, which varies by hundreds of MiB
 * between identical runs. CI gives the Lint step `--max-old-space-size=8192` (`.github/workflows/ci.yml`);
 * this budget sits under that ceiling so growth is reported in one line long before it becomes a V8 FATAL.
 * A requirement on top of its ceiling is a coin flip: the gate once both passed and failed at 2,048 MiB
 * on one commit, because survival depends on GC timing. V8's own default old-space cap (~4,096 MiB) is why the
 * flag exists at all. The gate runs only on CI (the fleet's machine never carries a lap this
 * heavy), and by hand with the command below.
 *
 * ## Where the heap goes
 *
 * The Program lives on the TypeScript compiler server, a native child process this heap does not contain; this
 * process holds the in-scope source files it fetches and the checker's answers. So this budget and the V8 flag
 * above bound the Node half only; nothing in V8 bounds the server's half. Reproduce every figure here with
 * `SLOPWEAVER_HEAP_PHASES=1 bash scripts/tsc-owner.sh --timeout-seconds 600 --grace-seconds 5 --rss-ceiling-mib 10240 -- node_modules/.bin/tsx --expose-gc --max-old-space-size=8192 src/devLint/namedObjectParams.entry.ts`
 * (`slopweaver dev profile --gate named-object-params` reads the same phase lines; the owner's
 * `TSC_OWNER_RESULT` line carries the tree's sampled peak). MEASURED over one checkout, scan clean,
 * 29,801 loaded files — 17,556 in scope (129 MiB of text), 12,245 vendored:
 *
 * | phase                                     | Node live MiB |
 * | ----------------------------------------- | ------------- |
 * | `createProgram` (on the server)           | 19            |
 * | rule scan (the gate's whole requirement)  | 1,732         |
 *
 * The whole process tree peaked at 7,110 MiB (`peakRssKiB=7281040`), 19.7 s wall. The requirement tracks the
 * repository: the Node half grows with the in-scope sources this process fetches, the server half with every
 * loaded file, a dependency's vendored declarations included, which no in-scope count sees.
 *
 * ## What has been cut, and why each cut is safe
 *
 * - **The whole-repo semantic pass runs only after a violation (−926 MiB).** It decides whether a
 *   finding is real or an unresolved type; a clean scan never needed it, because an error type is a
 *   VIOLATION here, never a false clean (`namedObjectParams.ts`'s header). A violating scan asks only about
 *   the files carrying a finding.
 * - **The scan asks the checker last (−1,597 MiB).** The verdict is `!compliant && !exempt` and
 *   every half is pure, so the order is chosen for cost: the AST-only exemptions first (an unannotated
 *   callback parameter is the commonest signature in the repo, and asking for its type contextually types
 *   the whole enclosing call), then compliance, then the exemptions that resolve a call — and the
 *   by-reference exemption asks only about arguments spelled like the function's own name
 *   (`namedObjectParamsCallbacks.ts`).
 * - **Only in-scope files cross into this process.** The server holds every loaded file; this process fetches
 *   the in-scope ones the rule walks, and names the rest (`fileMixLine`).
 *
 * No cut changes a verdict. Over one detached checkout, the decision stream
 * (`./namedObjectParamsOracle.ts`) this rule writes on the TypeScript 7.1 server is byte-identical to the one
 * the TypeScript 6 in-process Program wrote: 249,278 rows, 47,991,211 bytes. `namedObjectParamsJsDoc.test.ts`
 * pins that every JSDoc comment a verdict or a diagnostic depends on is still read, and
 * `namedObjectParams/byReferencePrefilter.test.ts` the by-reference cases (alias, shorthand, constructor,
 * unicode escape).
 *
 * ## What was measured and rejected — beat these numbers before re-proposing one
 *
 * - **A split Program.** K=4 slices peaked at 2,307 MiB in 101 s and K=8 at 2,216 MiB in 314 s,
 *   against 2,828 MiB in ~40 s whole. The import closure of almost every `src/` directory is
 *   ~70% of the whole Program (a shared core of ~19,500 files; `src/__tests__` alone is 99%), and round-robin
 *   slices each reach 86% at K=2 and 75% at K=8. Every shard re-parses most of the repository.
 * - **Another tool.** `oxlint-tsgolint` (already in this repo) takes no custom rules; an oxlint JS plugin is
 *   not type-aware; ast-grep cannot resolve a type; jscodeshift parses to ESTree with no checker, and
 *   took 83.43 s and 1,656 MiB to parse the tree it then failed on one file of. The "options object" half
 *   needs resolved types, so a syntax-only rule checks the wrong thing.
 *
 * ## The reading
 *
 * MEASURED over one checkout, scan CLEAN, with the command above: 1,732 MiB live in two runs. The
 * budget stays at 6,543; lowering it is the owner's call.
 */
export const HEAP_BUDGET_MIB = 6543;

/**
 * The gate's live heap right now, in MiB, after forcing a major GC — or `undefined` when this process was
 * started without `--expose-gc`.
 *
 * The forced collection is the point. `used_heap_size` on its own counts garbage V8 has simply not bothered to
 * collect yet, which is why a peak-RSS reading of this gate varies by hundreds of MiB between identical runs
 * and is useless as a ratchet. What survives a major GC is the LIVE set, and the live set is what decides
 * whether the process fits under a ceiling.
 *
 * @returns the live heap in MiB, or `undefined` when it cannot be measured
 */
export function liveHeapMib(): number | undefined {
  // `globalThis.gc`, never a bare `gc`. `@types/node` declares `var gc: GCFunction | undefined`, which reads
  // as "always there, sometimes undefined" and is a runtime LIE: without `--expose-gc` the binding does not
  // exist at all, so `gc === undefined` throws ReferenceError before it can answer. Found by running the gate
  // without the flag, which is exactly the hand-run this branch exists to serve.
  const collect = globalThis.gc;
  if (collect === undefined) {
    return undefined;
  }
  collect();
  return Math.round(v8.getHeapStatistics().used_heap_size / 1024 / 1024);
}

/**
 * How a measured live heap reads against the budget: the line to print, and whether it busts.
 *
 * Pure, so the ratchet has a test rather than only a run. An unmeasured heap is reported as unmeasured and
 * never as a pass — the gate's own plan entry passes `--expose-gc`, so the only way here is a hand-run, and
 * silently printing a budget line that checked nothing is the failure class this whole file is built against.
 *
 * @param budgetMib the live heap this gate is allowed to need
 * @param liveMib the measured live heap, or `undefined` when it could not be measured
 * @returns the line to append to the verdict, and whether the budget was exceeded
 */
export function heapBudgetReport({ budgetMib, liveMib }: { budgetMib: number; liveMib: number | undefined }): {
  readonly line: string;
  readonly overBudget: boolean;
} {
  if (liveMib === undefined) {
    return {
      line: `live heap not measured (no --expose-gc), budget ${String(budgetMib)} MiB unchecked`,
      overBudget: false,
    };
  }
  return {
    line: `live heap ${String(liveMib)} MiB of a ${String(budgetMib)} MiB budget`,
    overBudget: liveMib > budgetMib,
  };
}

/**
 * Set this env var to any value and the gate prints where its heap actually goes, phase by phase.
 *
 * The budget line above says the requirement grew; it never says WHAT grew, and the in-scope source count
 * alone is blind to the vendored half of what the Program loads. This exists so that evidence is a command
 * anyone can re-run rather than a scratch script someone wrote once, per the measured-comment rule in
 * `.claude/rules/typescript-patterns.md`.
 */
const PHASE_REPORT_ENV = "SLOPWEAVER_HEAP_PHASES";

/**
 * One phase line of the heap report: where the gate had got to, and what it was holding there.
 *
 * @param label the phase just completed
 * @param liveMib the live heap after a forced GC, or `undefined` without `--expose-gc`
 * @returns the line to print
 */
export function phaseLine({ label, liveMib }: { label: string; liveMib: number | undefined }): string {
  const held = liveMib === undefined ? "unmeasured (no --expose-gc)" : `${String(liveMib)} MiB`;
  return `named-object-params phase: ${label.padEnd(20)} ${held}`;
}

/**
 * What the Program actually loaded, split into the part this rule governs and the part it merely needs.
 *
 * The split is the point. A budget extrapolated from the in-scope count under-budgets by construction, because
 * a dependency's declarations are real load that count never sees — so the report names both. Only the in-scope
 * files' text is in this process; a dependency's tree stays on the compiler server, so it is counted by name.
 *
 * @param loaded every file name the Program holds
 * @param inScope the in-scope source files this process fetched
 * @returns the line to print
 */
export function fileMixLine({
  loaded,
  inScope,
}: {
  loaded: readonly string[];
  inScope: readonly Pick<ts.SourceFile, "text">[];
}): string {
  const vendored = loaded.filter((fileName) => fileName.includes("node_modules"));
  const textMib = String(Math.round(inScope.reduce((n, f) => n + f.text.length, 0) / 1024 / 1024));
  return (
    `named-object-params files: loaded ${String(loaded.length)}, ` +
    `in-scope ${String(inScope.length)} (${textMib} MiB text), ` +
    `vendored ${String(vendored.length)}`
  );
}

/**
 * Whether the phase report is switched on for this run.
 *
 * @returns true when `SLOPWEAVER_HEAP_PHASES` is set in the environment
 */
export function phasesOn(): boolean {
  return process.env[PHASE_REPORT_ENV] !== undefined;
}

/**
 * The phase sink: a no-op unless the report is switched on, so a normal run pays no forced GC per phase.
 *
 * @returns a function taking the label of the phase just completed
 */
export function phaseReporter(): (label: string) => void {
  if (!phasesOn()) {
    return () => undefined;
  }
  return (label) => {
    process.stdout.write(`${phaseLine({ label, liveMib: liveHeapMib() })}\n`);
  };
}
