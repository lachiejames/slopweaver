import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { COVERAGE_EXCLUDE, COVERAGE_INCLUDE } from "../../src/devLint/coverageExclude.js";
import { anchorCoverageGlobs } from "../../src/devLint/coverageGlobs.js";

/** The ambient-home guard every lane loads — see `src/__tests__/setup-ambient-home.ts`. */
export const AMBIENT_HOME_SETUP = "./src/__tests__/setup-ambient-home.ts";

/**
 * The temp-root sandbox every lane loads FIRST — see `src/__tests__/setup-temp-root.ts`. Order matters: it
 * moves `$TMPDIR` at module scope, so the setup files after it (and every fixture they mint, the ambient-home
 * sandbox included) land inside the root it removes.
 */
export const TEMP_ROOT_SETUP = "./src/__tests__/setup-temp-root.ts";

/**
 * The RUN-level half of the same sandbox — see `src/__tests__/global-temp-root.ts`. It runs in the main
 * process, so unlike a worker hook it survives a skipped file and a dead worker alike. Declared once here:
 * no lane overrides `globalSetup`, so all three inherit it through the spread.
 */
export const TEMP_ROOT_GLOBAL = "./src/__tests__/global-temp-root.ts";

/**
 * The TypeScript lifecycle teardown every lane loads LAST — see `src/__tests__/setup-typescript-lifecycle.ts`. It
 * closes every seam client after each test file; `afterAll` hooks unwind in reverse, so it runs before the
 * temp-root teardown registered ahead of it.
 */
export const TYPESCRIPT_LIFECYCLE_SETUP = "./src/__tests__/setup-typescript-lifecycle.ts";

/** Every lane's coverage provider module — see `config/vitest/coverageProvider.ts`. */
export const COVERAGE_PROVIDER_MODULE = "./config/vitest/coverageProvider.ts";

/** Two levels up from this file (`config/vitest/`) — the repo root every coverage glob is anchored at. */
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Shared Vitest base for all three test lanes (design ported from the private archive's `baseVitestConfig`,
 * re-skinned for this single-package repo). The unit lane (`config/vitest/unit.ts`), the subprocess lane
 * (`config/vitest/subprocess.ts`), and the integration lane (`config/vitest/integration.ts`) each spread
 * `baseVitestConfig.test` and add their own `include` glob + lane-specific settings. Tier is selected by
 * DIRECTORY — `src/__tests__/unit/**` vs `src/__tests__/subprocess/**` vs `src/__tests__/integration/**` —
 * never a filename suffix.
 *
 * Each lane writes to its OWN report directory, which is not tidiness: the floor ratchet reads
 * `coverage/coverage-summary.json`, so a second lane pointed there would silently hand the unit floor
 * another lane's number to check.
 *
 * `isolate: true` is the BASE, and the unit lane alone narrows it to `false` (`config/vitest/unit.ts` carries
 * the measurement); integration holds a process-global Polly patch and subprocess wants fresh processes, so both
 * inherit `true`. It is pinned explicitly rather than left to Vitest's own default: this repo's OOM incident
 * (a broken pagination test fixture looping until a worker's heap died) was independently confirmed unrelated
 * to isolation, but the
 * investigation depended on knowing exactly what the runtime does per file, and a future Vitest default
 * change silently flipping this is exactly the kind of drift that cost a whole session to notice once.
 */
export const baseVitestConfig = defineConfig({
  test: {
    // The coverage-floor ratchet reads the V8 `json-summary`; `text` keeps the terminal readable. Defined
    // once here so every lane shares it. Every test + the integration-test infra (Polly setup, gateway,
    // fixtures) lives under `src/__tests__/**`, so a single exclude covers them all — anchored at
    // `projectRoot`, because Vitest matches these patterns against the ABSOLUTE path with
    // picomatch `contains: true` (see `coverageGlobs.ts`).
    //
    // The provider is V8 through `coverageProvider.ts`: upstream's own, with a fold in front of it that stops
    // each raw dump re-normalising the whole lane (measured there and in `src/testLanes/coverageFold.ts`).
    coverage: {
      customProviderModule: COVERAGE_PROVIDER_MODULE,
      exclude: [...anchorCoverageGlobs({ patterns: COVERAGE_EXCLUDE, root: projectRoot })],
      include: [COVERAGE_INCLUDE],
      provider: "custom",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
    },
    globalSetup: [TEMP_ROOT_GLOBAL],
    isolate: true,
    // The temp-root sandbox, the ambient-home guard and the TypeScript lifecycle teardown, spelled in every
    // lane rather than only here: a lane that declares its OWN `setupFiles` REPLACES this array rather than
    // extending it (the integration lane declares `setup-polly.ts`), so a base-only entry would be silently
    // dropped by exactly the lane that added a setup file. `unit/ambientHomeGuard.test.ts` asserts every
    // effective lane list carries all three, temp root first — it moves `$TMPDIR` at module scope, so anything
    // a later setup file mints belongs inside it.
    setupFiles: [TEMP_ROOT_SETUP, AMBIENT_HOME_SETUP, TYPESCRIPT_LIFECYCLE_SETUP],
    // FALSE, not the Vitest default. A `true` here made a filtered `vitest run <path>` naming a directory or
    // file with no matching tests exit 0 — so a handover `doneWhen:` probe of exactly that shape read as
    // PASS before the work it named had been written, and would stay green forever if it never was. All
    // three lanes were measured unfiltered against `false` before flipping (each always matches at least one
    // file, so the flag never fires there): `yarn vitest run --config config/vitest/unit.ts
    // --passWithNoTests=false` (1099 files), `--config config/vitest/subprocess.ts` (44 files), `--config
    // config/vitest/integration.ts` (15 files) — all exit 0 unchanged. `handover check`'s
    // `checkFilteredVitestProbes` still refuses a probe missing `--passWithNoTests=false` explicitly, as
    // belt-and-braces for a doc checked against a DIFFERENT repo, where this file's default does not apply.
    passWithNoTests: false,
    // `list`, not Vitest's default `parallel`: the order spelled in `setupFiles` is a contract (temp root first,
    // TypeScript teardown last), and a lane that reuses one fork across files (the unit lane) runs each setup
    // file's module scope again per file against the same process, so the order has to be the one written.
    sequence: { setupFiles: "list" },
  },
});
