/**
 * The two exports of `@bcoe/v8-coverage` this repository calls, typed: the package ships plain CommonJS with no
 * declarations. They are the merge `@vitest/coverage-v8` folds every raw dump with, and the shape is read off its
 * `src/lib/merge.js`: a list of process coverages in, one normalised process coverage out, where a script
 * merged from more than one input comes back WITHOUT the `startOffset` Vitest adds (upstream restores it).
 */
declare module "@bcoe/v8-coverage" {
  import type { Profiler } from "node:inspector";

  /** One process coverage: every script's V8 coverage, plus the `startOffset` Vitest's worker attaches. */
  interface ProcessCov {
    result: (Profiler.ScriptCoverage & { startOffset?: number })[];
  }

  /**
   * Merge process coverages into one normalised coverage. Mutates its inputs, as upstream documents.
   *
   * @returns the merged coverage, scripts sorted by url and their ids renumbered
   */
  // named-object-params-exempt: declares @bcoe/v8-coverage's own mergeProcessCovs(processCovs), called positionally
  export function mergeProcessCovs(processCovs: readonly ProcessCov[]): ProcessCov;

  /**
   * Merge one script's coverages. Given exactly ONE, it normalises that script deeply, in place, and returns it:
   * the single-input pass `mergeProcessCovs` applies to every script a dump does not carry.
   *
   * @returns the merged script, or `undefined` for an empty list
   */
  // named-object-params-exempt: declares @bcoe/v8-coverage's own mergeScriptCovs(scriptCovs), called positionally
  export function mergeScriptCovs(
    scriptCovs: readonly ProcessCov["result"][number][],
  ): ProcessCov["result"][number] | undefined;
}
