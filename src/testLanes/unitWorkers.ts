/**
 * How many forks a Vitest lane may run on a shared machine, and the unit lane's default when no `--maxWorkers`
 * is passed: the lap's proven width, never more than Vitest's own default. Pure: the machine's numbers in, a
 * count out; `config/vitest/unit.ts` reads `availableParallelism()` and `CI` and hands them here.
 *
 * ## Why the unit lane needs it, and why not a memory budget
 *
 * Vitest 4.1 sizes a run pool at `availableParallelism() - 1` and never looks at memory for a `forks` pool: its
 * `getMemoryLimit` returns `null` for anything but `vmForks`/`vmThreads`, so nothing recycles a fork that grows.
 * The unit lane is the one lane that runs NON-ISOLATED (`config/vitest/unit.ts`), so each fork keeps the module
 * graph of every file it has run. MEASURED: one whole-tree `yarn test:unit` on a 10-core, 16 GiB machine took
 * the default 9 forks and drove swap from 4.2 of 5 GB to 11.8 of 13 GB (13 swapfiles, `slopweaver machine
 * capacity`), ending 108133 of 108142 with nine 20–48 s timeouts in seven files that pass alone, 51 of 51 in
 * 9.6 s.
 *
 * A per-worker memory budget was planned and dropped: the process-tree peak it needs is a whole-tree run the
 * whole-tree-check guard refuses, under the compile lease a lap needs. What IS measured is the lap's shape — six
 * shards in sequence at {@link UNIT_LANE_MAX_WORKERS} forks — green on that same machine in three laps of one night,
 * swap 3.9 of 5 → 4.3 of 6 GB and swapfiles 5 → 6 across the last one's six shards (114–140 s each). So the
 * config caps every unit run at that width, and `yarn validate` runs that exact shape (`./unitSequence.ts`).
 *
 * ## What it does not bound
 *
 * A whole-tree run at 4 forks hands each fork about a quarter of the tree, against a shard fork's twenty-fourth,
 * so its per-fork memory is not what the laps measured; two runs at once each take their own 4; and a caller's
 * own `--maxWorkers` wins. Under `CI=true` the cap is off: a CI shard owns its runner alone, this repository's
 * `ubuntu-latest` (4 vCPU) gives Vitest's 3 either way, and the lap, which sets `CI=true`, passes its width
 * explicitly.
 */

/**
 * The unit lane's cap off CI: the lap's width, `LAP_VITEST_MAX_WORKERS` (`src/cli/commands/github/lapCore.ts`).
 * Spelled again rather than imported, because nothing outside `src/cli/` may import a verb module
 * (`cli-command-boundary`) and moving the lap's constant out of `lapCore.ts` would take it out of the lap's
 * plan-source comparison (`LAP_PLAN_SOURCES`). `unit/testLanes/unitWorkers.test.ts` fails if the two part.
 */
export const UNIT_LANE_MAX_WORKERS = 4;

/**
 * The unit lane's worker count: Vitest's own run-mode default of one fewer than the cores, at least one, and
 * off CI never more than {@link UNIT_LANE_MAX_WORKERS}.
 *
 * @param cpus usable cores, from `os.availableParallelism()`
 * @param ci whether `CI` is `true`, where a lane owns its runner alone
 * @returns the `maxWorkers` the unit config sets
 */
export function unitLaneMaxWorkers({ cpus, ci }: { cpus: number; ci: boolean }): number {
  const vitestDefault = Math.max(cpus - 1, 1);
  return ci ? vitestDefault : Math.min(vitestDefault, UNIT_LANE_MAX_WORKERS);
}
