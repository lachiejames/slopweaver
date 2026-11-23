import { defineConfig } from "vitest/config";
import { baseVitestConfig } from "./base.js";

/**
 * The UNIT lane — pure functions, zero I/O. Tests are selected by DIRECTORY, not a filename suffix, and
 * there are THREE of them: `src/__tests__/unit/**`, `site/__tests__/unit/**` and `desktop/__tests__/unit/**`
 * (see the `include` below for why the console and the desktop shell cannot be tested from the first). Real
 * `git`-subprocess tests live under
 * `src/__tests__/subprocess/**`
 * (see `config/vitest/subprocess.ts`) — a real-I/O exception sanctioned via `tempGitRepo.ts`, not a unit
 * test by this lane's own bar. The integration lane lives under `src/__tests__/integration/**` (it drives
 * real GitHub/Slack/Linear provider calls through a Polly cassette) — see `config/vitest/integration.ts`.
 *
 * Run: `yarn test:unit`, which always passes `--coverage`. Measured overhead varies by machine and load
 * (roughly seconds, not the ~0.4s once assumed here) — there is still no separate coverage script to forget:
 * every unit run leaves a report, so the floor gate always has something to check and CI enforces coverage
 * rather than skipping it.
 *
 * ## `testTimeout`, and why it is the same defect the subprocess lane already documents
 *
 * `config/vitest/subprocess.ts` records this failure in detail: under ambient fleet load, a lane running at
 * Vitest's 5s default fails a DIFFERENT file each run with the identical `Test timed out in 5000ms`, and
 * every victim passes in seconds when run alone. That is the signature of starvation rather than a hang,
 * and that lane raised its budget to 60s for it.
 *
 * The unit lane has the same exposure and had not been given the same treatment. MEASURED, this
 * machine at `uptime` load average 33 with 15 users: two full `yarn validate` runs failed
 * `src/__tests__/unit/atlas/jumpcloud/sync.test.ts` on `Test timed out in 5000ms`, while that file's whole
 * directory — 319 tests — passed standalone twice in 6.2s and 8.7s of wall clock. The tests are not slow;
 * they publish 74 kind files each and lose the race for a disk that twenty sessions are also using.
 *
 * 20s rather than the subprocess lane's 60s, because a unit test does no I/O by this lane's own bar and
 * anything approaching 20s is a defect worth failing on. It weakens nothing: a genuinely hung unit test
 * still fails, four times slower than before.
 *
 * ## `hookTimeout` must be spelled too, or the budget above is a lie for exactly the work that needs it
 *
 * Vitest applies `testTimeout` to a test and `hookTimeout` — a SEPARATE setting, defaulting to 10s — to a
 * `beforeAll`/`afterAll`. Raising one and not the other left this lane with a 20s budget for its cheap work
 * and a 10s budget for its expensive work, because the standard remedy for a slow suite is to hoist the
 * expensive part into a `beforeAll` and share it.
 *
 * That is not hypothetical. `src/__tests__/unit/atlas/datadog/readAdapter.test.ts` and its sibling
 * `sync.test.ts` each say in their own comments that they hoisted a 1,735-entity, 144-file catalogue sync
 * into `beforeAll` to get under "vitest's 20-second per-test timeout on a loaded machine" — and by moving
 * it, put it under a 10s one instead. Both then failed a full-lane run under fleet load and
 * passed in isolation, which is the starvation signature this whole comment is about, not a regression.
 * Measured at load 15, standalone: `yarn vitest run --config config/vitest/unit.ts
 * --coverage=false src/__tests__/unit/atlas/datadog/` runs in 13.6s with single tests reaching 3.2s — so
 * the fifteen-worker lane has roughly a 3x margin at 10s and a 6x margin at 20s.
 *
 * The integration lane already spelled both. This is the unit lane catching up, and
 * `src/__tests__/unit/ambientHomeGuard.test.ts` now asserts no lane may raise one without the other.
 *
 * ## The one family that stays here on a longer budget: real git under `src/__tests__/unit/worktree/`
 *
 * Those files spawn real git, and moving them to the subprocess lane would take `src/worktree` below its
 * coverage floor, which only this lane measures. So they keep 20s as the lane's bar and opt out per suite:
 * `REAL_GIT_SUITE` (`src/__tests__/tempGitRepo.ts`) gives each git-driving describe 60s and ONE retry that
 * fires only on a timeout. Its docstring carries the measurement; `unit/worktree/realGitSuites.test.ts`
 * fails a new git-driving file that forgets it.
 */
export default defineConfig({
  test: {
    ...baseVitestConfig.test,
    hookTimeout: 20_000,
    // THREE roots, and the second and third are not a convenience. `site/` is a separate Yarn project, and a file
    // under `src/` may not import one outside it: `tsconfig.build.json` sets `rootDir: ./src`, so a root
    // test importing `site/lib/queueCard.ts` pulls it into the emit program and fails the CI `compile` job
    // with TS6059 — which is the one class that job exists to catch, so narrowing the emit program to let
    // it through would be weakening a gate. The console's pure modules import nothing and are the only
    // thing reached here; the site's own `next build` still typechecks them. `desktop/` (desktop/README.md)
    // is the same shape: its pure modules are tested here and its own `tsc` in the `desktop` CI job
    // typechecks them, while the root `tsconfig.json` typechecks its unit tests (it excludes only
    // `desktop/src`, so the tests and the pure modules they import are in the `typecheck` job's program).
    // The merge's cross-check reads `UNIT_LANE_INCLUDE` (`src/testLanes/unitShards.ts`), and
    // `unit/testLanes/unitShards.test.ts` fails if the two ever part.
    include: [
      "src/__tests__/unit/**/*.test.ts",
      "site/__tests__/unit/**/*.test.ts",
      "desktop/__tests__/unit/**/*.test.ts",
    ],
    // NOT ISOLATED — the one setting that scales with how many FILES the lane holds rather than how many tests.
    // Vitest 4.1 gives every isolated test file a brand-new fork (`getPoolRunner` never reuses an isolated
    // runner), so each file re-spawns Node, re-loads node_modules and re-runs its setup before one test runs.
    // That fixed cost was MEASURED at ~1.2 worker-seconds a file, and it is what grew: unit files went from 2,205
    // to 7,021 through "one file per behaviour" splits while the tests themselves stayed a
    // small slice. Paired on one such split, the same 37 tests cost 2.2 worker-seconds as one file and 12.1
    // as nine. Setup files still run before EVERY file, so the temp-root, ambient-home and TypeScript-lifecycle
    // guards keep their per-file contract, restoring what they own at the worker's baseline (`envSnapshot.ts`).
    // The residue, stated rather than discovered: a timer or callback an earlier file left running can still
    // fire inside the next file, which a fresh fork would never see. Vitest's `detectAsyncLeaks` names such a
    // file when one is suspected. Re-measure one directory either way with
    // `yarn vitest run --config config/vitest/unit.ts --coverage=false --isolate src/__tests__/unit/handover/`.
    isolate: false,
    // FORKS — Vitest's default, and it is RECORDED here rather than left implicit because flipping it to
    // `threads` is the obvious cut at this lane and it was MEASURED WORSE.
    //
    // The premise was sound and the result refuted it. `unit` is the last `ci.yml` job over the
    // five-minute bar, and it is over on its TEST STEP rather than its install: over six `pull_request`
    // runs the job is p50 5:51 / p95 6:00 with `Unit tests` alone p50 4:58 / p95 5:14 and `yarn install`
    // 0:39. A thread should have been the cheaper container for ~1,099 files whose own lane contract is
    // pure functions and zero I/O. It was not. PAIRED on one branch and one runner: the
    // threads lap took 397s and the forks lap took 346s, so threads cost
    // 51 SECONDS. The `ratchet` job failed the threads lap `REGRESSED` against its 358s baseline and passed
    // the forks one. Re-read both with `slopweaver github ci-runs --branch cut-e-unit-lane-threads-291-56
    // --event pull_request --runs 2 --json`.
    //
    // So the cut for this lane was not this one: it was more runners, six shard jobs whose reports merge into
    // one lane's coverage (`src/testLanes/unitShards.ts` carries the measurement). What survives from the attempt is
    // the `cwd` seam on `routingFlagSuffix`/`routedValue`: two tests in `unit/handover/lifecycleRun.test.ts`
    // reached for `process.chdir` (which a worker thread refuses outright) to resolve a relative
    // `--dir`/`--home`, and injecting the directory is what `.claude/rules/testing.md` asks for over
    // mutating global process state either way.
    testTimeout: 20_000,
  },
});
