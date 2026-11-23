/**
 * Every lane's coverage provider: `@vitest/coverage-v8`, unchanged, except that its raw dumps are folded without
 * re-normalising the whole lane on every one (`src/testLanes/coverageFold.ts` carries the measurement and the
 * equivalence argument).
 *
 * ## What is replaced, and what is not
 *
 * Only `readCoverageFiles` is overridden, and it is a PUBLIC member of Vitest's `BaseCoverageProvider`. Upstream's
 * own reading loop still runs: it calls our `onFileRead` once per dump, which folds that dump with
 * {@link foldCoverageDump}; at each project and environment's `onFinished` ONE handoff ({@link handoffCoverage})
 * goes to upstream's own `onFileRead`, built so that upstream's single step over it leaves exactly what its step per
 * dump would have, and its conversion, its uncovered-file pass and every report then run as before over the same
 * coverage. The worker half — starting, taking and stopping V8 coverage — is the upstream module's, spread in whole.
 *
 * The assumption this rests on is upstream's step itself: `mergeProcessCovs([merged, coverage])`, then a
 * `startOffset` restore from the dump. `unit/testLanes/coverageFold.test.ts` reads the installed provider and fails
 * if either line is ever not there, so a Vitest bump that changes the step says so instead of drifting.
 *
 * `vitest --merge-reports` never reads a raw dump — it merges each shard's converted map — so the shard merge
 * (`src/testLanes/unitMerge.ts`) runs the stock `v8` provider instead of this one.
 *
 * The provider class is imported inside `getProvider`, as upstream's own module does, so a worker — which loads
 * this module only for its coverage hooks — never loads `vitest/node`.
 */

import { mergeProcessCovs, mergeScriptCovs } from "@bcoe/v8-coverage";
import v8CoverageModule from "@vitest/coverage-v8";
import type { CoverageProvider, CoverageProviderModule } from "vitest/node";
import {
  type CoverageOps,
  emptyCoverageFold,
  foldCoverageDump,
  handoffCoverage,
} from "../../src/testLanes/coverageFold.js";

/** The process coverage every dump holds, as `@bcoe/v8-coverage` types it. */
type ProcessCov = Parameters<typeof mergeProcessCovs>[0][number];

/** One script's coverage within it. */
type Script = ProcessCov["result"][number];

/** The merge upstream folds with, and the single-input pass it applies to every script a dump does not carry. */
const OPS: CoverageOps<Script> = {
  merge: mergeProcessCovs,
  normalize: (script) => {
    const normalized = mergeScriptCovs([script]);
    if (normalized === undefined) {
      throw new Error("mergeScriptCovs answered nothing for one script, which its source never does");
    }
    return normalized;
  },
};

/**
 * Build the provider: upstream's V8 provider with the touched-only fold in front of its own.
 *
 * @returns the provider Vitest drives for the lane
 */
async function foldingProvider(): Promise<CoverageProvider> {
  const { V8CoverageProvider } = await import("@vitest/coverage-v8/dist/provider.js");
  class FoldingV8CoverageProvider extends V8CoverageProvider {
    override async readCoverageFiles({
      onFileRead,
      onFinished,
      onDebug,
    }: Parameters<InstanceType<typeof V8CoverageProvider>["readCoverageFiles"]>[0]): Promise<void> {
      let folded = emptyCoverageFold<Script>();
      await super.readCoverageFiles<ProcessCov>({
        onDebug,
        onFileRead: (dump) => {
          folded = foldCoverageDump({ dump, folded, ops: OPS });
        },
        onFinished: async (project, environment) => {
          // A project and environment that wrote no dump never reached upstream's `onFileRead` at all.
          if (folded.held !== undefined) {
            onFileRead(handoffCoverage({ folded, ops: OPS }));
          }
          folded = emptyCoverageFold<Script>();
          await onFinished(project, environment);
        },
      });
    }
  }
  return new FoldingV8CoverageProvider();
}

/** The module Vitest loads as `coverage.customProviderModule`, in the main process and in every worker. */
const foldingCoverageModule: CoverageProviderModule = { ...v8CoverageModule, getProvider: foldingProvider };

export default foldingCoverageModule;
