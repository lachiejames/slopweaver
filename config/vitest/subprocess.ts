import { defineConfig } from "vitest/config";
import { baseVitestConfig } from "./base.js";

/**
 * The SUBPROCESS lane — `src/__tests__/subprocess/**` only. Most of these tests spawn a real `git` subprocess
 * through the sanctioned `tempGitRepo.ts` door (see the `git-in-tests` gate), each against its own
 * throwaway temp-directory repository; a few (e.g. `cli/commands/connect/fixture.test.ts`) instead spawn the
 * real, shipped `bin/slopweaver` binary itself, to prove something the injected-fake unit lane cannot: that
 * the actual CLI entry point wires a seam the way its shell claims to. Both are real I/O, so neither belongs
 * on the unit lane's pure-function bar (`config/vitest/unit.ts`) — but unlike the integration lane, there is
 * no process-global state to protect (no Polly, no shared `fetch` patch), so full serialization (that
 * lane's `fileParallelism: false`) is not needed for correctness here.
 *
 * `maxWorkers` capped rather than left at Vitest's default (one worker per core — 15 on the machine this
 * was measured on): the lane was racing ITSELF, not just absorbing ambient load. Measured on a
 * clean tree: a full run reported `tests 1303.27s` of real work compressed into `Duration 131.12s` wall —
 * ~10x oversubscription, every one of those workers shelling real `git` against its own temp repo at once.
 * Two files that pass in ~20s/~58s standalone (`stackSquash.test.ts`, `worktree.test.ts`) blew their
 * `REAL_GIT_TIMEOUT_MS` budget under that self-inflicted contention, on top of whatever else the machine was
 * doing — a different victim each run is the signature of the lane starving itself, not a hang. A budget
 * bump is a slower coin flip against that; this caps the concurrency causing it instead.
 *
 * `testTimeout` raised from Vitest's 5s default, and it is the OTHER half of the same starvation the
 * `maxWorkers` cap addresses rather than a second guess at it. Every test in this lane shells a real `git`
 * or the real `bin/slopweaver`, and a spawn that costs ~2s alone routinely costs more than 5s while three
 * siblings are doing the same. MEASURED on this tree: two consecutive full runs failed a
 * DIFFERENT pair of files each time, every failure the identical `Test timed out in 5000ms`, and each victim
 * passed in seconds when run alone — the lane's own "different victim each run" signature, one level down.
 * Six of the sixteen spawning files had already reached for `{ timeout: 60_000 }` per test, so the bound was
 * agreed and simply not applied to the other ten; this states it once for the lane instead. It weakens
 * nothing: a genuinely hung spawn still fails, twelve times slower than before.
 *
 * `retry: 1` — the third defect the same starvation causes, one level up from the two above: even a 60s
 * per-test budget is a wall-clock bet, and the lane's own bettor is the FLEET, not this lane's `maxWorkers`
 * cap. MEASURED: four runs of one
 * unmodified commit, ambient `uptime` load 16-26 (15+ other sessions each capable of running a full vitest
 * suite), reported 0, 1, 2 and 3 timeout failures respectively — same commit, same code, only ambient load
 * changed — and each failure was `Error: Test timed out in 5000ms` in a file the diff under test never
 * touched, a different file each run. Two shapes were considered and rejected in favour of this one:
 * - **A load-average precheck that refuses to start the gate above some threshold** trades a slow flaky
 *   failure for an outright refusal with no retry path — a correct push simply cannot land while the fleet
 *   stays busy, and "busy" has no principled cutoff: the same load average means something different on a
 *   15-core machine than a 4-core one, so the threshold is a number invented for THIS machine, not a
 *   property of the lane.
 * - **Removing the wall-clock budget from the three files actually observed failing** treats a symptom, not
 *   the mechanism: the failure signature across all four runs is "a DIFFERENT file each time" (this
 *   docstring's own `maxWorkers` paragraph names the identical signature one level down), which means any of
 *   the lane's ~16 real-subprocess files is a future victim, not just the three caught so far. A per-file
 *   fix chases whichever file the last run happened to catch.
 * Vitest's `retry` re-runs only the FAILED test, in-process, without re-launching the other ~40 files in the
 * lane — so a timing red costs one extra pass at that single test (seconds) rather than a fresh 7-minute
 * gate lap. It weakens nothing a genuine bug relies on: a real assertion failure is deterministic and fails
 * identically on the retry, so it still reddens the gate — only a transient, contention-caused timeout gets
 * the second chance a human already gives it by hand (re-running the gate and watching it go green with no
 * code change, which is exactly what the four measured runs above did).
 *
 * `hookTimeout` matched to it, for the reason `config/vitest/unit.ts` sets out at length: Vitest budgets a
 * `beforeAll` from a SEPARATE setting that defaults to 10s, so a lane that raises only `testTimeout` gives
 * its tightest budget to the setup work suites hoist into a hook precisely BECAUSE it is expensive. This
 * lane spawns real `git` and the real `bin/slopweaver` from hooks as well as from tests, and every argument
 * above for 60s applies unchanged to a hook that does the same thing.
 * `src/__tests__/unit/ambientHomeGuard.test.ts` asserts no lane may raise one without the other.
 *
 * ## The cap is the OFF-CI regime, and no number is written for CI
 *
 * Every measurement above was taken on a 15-core DEVELOPER machine carrying 15+ concurrent sessions, and
 * it is still true of that machine — so the cap stays exactly as measured there. CI is not that machine:
 * the `subprocess` job has the larger runner to itself, and `.github/workflows/ci.yml`'s "Runner facts"
 * step fails the job outright unless `RUNNER_ENVIRONMENT` is `github-hosted`, so there is no fleet for the
 * lane to lose a race against. Obeying a contended-machine remedy on an uncontended one cost the
 * `Subprocess tests` step real minutes against the owner's five-minute bar.
 *
 * So the spread below OMITS the key on CI rather than raising it, and that absence is the whole point. A
 * number here would be this file guessing at a runner it cannot see, and it would be wrong the day the
 * `runs-on:` label is repointed at a different size. Absent, Vitest falls back to its own
 * `availableParallelism` — the runner asking itself, correct on a 4-core machine and on a 32-core one,
 * needing no re-measurement when the label moves. A conditional spread rather than `maxWorkers: undefined`
 * because `exactOptionalPropertyTypes` makes those two different things.
 *
 * What this deliberately does NOT spend: `retry: 1` and the two 60s budgets are the lane's existing guard
 * against the very timing reds this docstring is about, and they are untouched. MEASURED on CI, this
 * branch's own run took the `Subprocess tests` step from 5:22 to 4:01 and the job from 6:16 to 4:52, under
 * the bar. Read it again with `slopweaver github ci-runs --branch <branch> --event pull_request --runs 1
 * --steps`.
 *
 * Run: `yarn test:subprocess` (report-only coverage, not gated — see `test:subprocess:coverage`), mirroring
 * the existing `test:integration`/`test:integration:coverage` split.
 */
export default defineConfig({
  test: {
    ...baseVitestConfig.test,
    // Off CI only. Absent on CI so Vitest takes the runner's own `availableParallelism` — the two
    // paragraphs above are why the key is omitted rather than given a bigger number.
    ...(process.env["CI"] === "true" ? {} : { maxWorkers: 4 }),
    coverage: { ...baseVitestConfig.test?.coverage, reportsDirectory: "coverage-subprocess" },
    hookTimeout: 60_000,
    include: ["src/__tests__/subprocess/**/*.test.ts"],
    retry: 1,
    testTimeout: 60_000,
  },
});
