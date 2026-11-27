/**
 * The aggregator's good steps, written out by hand and shared by the two files that judge them:
 * `ciOffloadContract.test.ts`, whose whole-workflow fixture carries them, and `ciAggregatorSteps.test.ts`,
 * which breaks one of them at a time. Written out rather than derived from the pinned tail, so a change to the
 * declaration under test cannot silently change what "the good shape" means here too.
 */
import { DEPENDENCY_CACHE_INPUTS, SAVE_CONDITION } from "../../../devLint/ciDependencyCache.js";
import { RUNNER_FACTS_STEP } from "../../../devLint/ciRunnerFacts.js";
import { FETCH_BASE_STEP } from "../../../devLint/ciWorkerRuns.js";

/** The `ALL_SUCCEEDED` expression over every worker, in `build.needs` order. */
export const VERDICT =
  "${{ needs.lint.result == 'success' && needs.typecheck.result == 'success' && needs.unit-1.result == 'success' && " +
  "needs.unit-2.result == 'success' && needs.unit-3.result == 'success' && needs.unit-4.result == 'success' && " +
  "needs.unit-5.result == 'success' && needs.unit-6.result == 'success' && " +
  "needs.subprocess.result == 'success' && needs.desktop-e2e.result == 'success' && " +
  "needs.compile.result == 'success' && needs.desktop.result == 'success' && needs.site.result == 'success' }}";

/**
 * The aggregator's first step, in the shape the gate accepts.
 *
 * @returns a fresh copy each test may break
 */
export const verdictStep = (): Record<string, unknown> => ({
  env: { ALL_SUCCEEDED: VERDICT },
  if: "${{ always() }}",
  run: 'test "$ALL_SUCCEEDED" = "true"',
  shell: "bash",
});

/**
 * The cached root install: a restore straight before it, and for the one writer a save straight after.
 *
 * @param writer whether this job is the one that saves the cache on `main`
 * @returns the install's steps
 */
export const install = ({ writer }: { writer: boolean }): Record<string, unknown>[] => [
  { id: "deps", uses: "actions/cache/restore@v4", with: DEPENDENCY_CACHE_INPUTS },
  { run: "yarn install --immutable" },
  ...(writer ? [{ if: SAVE_CONDITION, uses: "actions/cache/save@v4", with: DEPENDENCY_CACHE_INPUTS }] : []),
];

/**
 * Everything `build` runs after its verdict, written out: the runner assertion, the setup the merge needs, the
 * shards' report download, the merge and the measured floor.
 *
 * @returns a fresh copy each test may break
 */
export const buildTail = (): Record<string, unknown>[] => [
  { ...RUNNER_FACTS_STEP },
  { uses: "actions/checkout@v4" },
  { ...FETCH_BASE_STEP },
  { uses: "actions/setup-node@v4", with: { "node-version-file": ".nvmrc" } },
  { run: "corepack enable" },
  ...install({ writer: false }),
  {
    uses: "actions/download-artifact@v4",
    with: { "merge-multiple": true, path: ".vitest-reports", pattern: "unit-blob-*" },
  },
  { name: "Merge the shards into the whole lane", run: "yarn test:unit:merge" },
  { name: "Coverage floor", run: "yarn coverage:ratchet" },
];
