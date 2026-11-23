/**
 * The ambient-home guard, wired into every test lane's `setupFiles`.
 *
 * Vitest runs a setup file once per TEST FILE, so each file gets its own sandbox home and two files racing
 * in different workers can never see each other's writes. The contract is one sentence: a test may write
 * anywhere it passes an explicit `home`, and nowhere else. {@link ambientHomeGuard.ambientHomeRefusal} has
 * the failure this closes, its measurement, and why it is a runtime witness rather than an AST gate.
 *
 * Two deliberate limits, stated rather than discovered:
 *
 * - **A test that sets `$SLOPWEAVER_HOME` itself is not fought.** `hygiene/scan.test.ts` pins the regression
 *   where an UNSET variable silently loaded an empty denylist, so it has to move the variable to exercise
 *   the fallback at all. The sandbox is restored after each test rather than asserted, so such a test stays
 *   legal and the next one is still isolated.
 * - **This sees WRITES, not reads, and it installs the sandbox in a `beforeAll`.** A test that reads the
 *   developer's real home under a deliberately unset variable is invisible here. Reads do not accumulate,
 *   which is the defect being closed; closing the read half HERE would mean an unset variable had to fail,
 *   and that is the one thing `hygiene/scan.test.ts` needs. It is closed statically instead, by the
 *   `env-home-read` half of `home-safety` — which matters because the hook ordering leaves a real hole: every
 *   setup file's and every test file's MODULE SCOPE runs before this `beforeAll`, so a read there gets the
 *   real home and a write through it lands entirely outside the directory `sandboxEntries` inspects.
 *   `setup-polly.ts` read it exactly that way. The record lane's own legitimate need for the real home goes
 *   through `realAmbientHome.ts` instead, whose capture is a module-scope `const` — so it runs before this
 *   `beforeAll` however the lane orders its setup files, and nothing in the tree has to remember the rule.
 *
 * The ACCOUNT home is the other read this file closes, and it closes it differently: `accountDefaultHome()` reads the
 * user database, not `$SLOPWEAVER_HOME`, so no variable can sandbox it, and this file installs a per-file sandbox in
 * a process slot at MODULE scope instead (`accountSandbox` below). That is a read-side sandbox, not a write guard.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll } from "vitest";
import { clearAccountHomeSandbox, installAccountHomeSandbox } from "../homeDir.js";
import { ambientHomeRefusal } from "./ambientHomeGuard.js";
import { restoreEnvironment, workerBaseline } from "./envSnapshot.js";

/** The env var `slopweaverHome()` reads before falling back to `~/.slopweaver`. */
const HOME_VAR = "SLOPWEAVER_HOME";

/**
 * The binary the live Codex account read launches (`codex/accountLive.ts`'s `APP_SERVER_ENV`), pointed at a path
 * that does not exist so no test reaches the operator's own Codex stores: a test that injects no fake reader
 * reads every store as `unreadable`, today's behaviour, on a laptop with Codex installed exactly as in CI.
 * Spelled as a literal because importing the reader would load the Codex SDK into every test file's setup;
 * `unit/codex/accountLiveLane.test.ts` asserts the two names agree. Set at MODULE scope so a test file's own
 * module body and every child it spawns inherit it, and restored after each test like the home.
 */
const APP_SERVER_VAR = "SLOPWEAVER_CODEX_APP_SERVER";

/**
 * The three keys this file moves, as the WORKER first saw them — restored in `afterAll`. The unit lane reuses a
 * fork across files (`envSnapshot.ts`), so without this the next file would begin with `$SLOPWEAVER_HOME` naming
 * this file's deleted sandbox, and `realAmbientHome.ts`, first imported at that file's module scope, would capture
 * the sandbox as the operator's real home. The worker's baseline, so a skipped file cannot become it.
 */
const owned = workerBaseline({ key: "ambient-home", names: [HOME_VAR, APP_SERVER_VAR, "SLOPWEAVER_STORE_URL"] });

// Restored at module scope as well as in `afterAll`: a previous file whose tests all skipped never reached its
// `afterAll`, and `$SLOPWEAVER_HOME` is only moved again in `beforeAll`, after the test module's own body has run.
restoreEnvironment({ snapshot: owned });

const absentAppServer = join(tmpdir(), "no-codex-app-server-in-tests");
process.env[APP_SERVER_VAR] = absentAppServer;

/**
 * The store selector `store/config.ts`'s `storeUrl` reads BEFORE the home's own `secrets/store-url`, so a value the
 * developer exported in their shell would bypass the sandbox home and point a test at a real database. Cleared at
 * MODULE scope, before any test module's body runs, and again after each test so one that sets it to exercise the
 * store cannot leak it to the next. Never restored: a worker is a sandbox, and its environment never reaches the
 * shell that launched it. An opt-in proof against a throwaway database reads its own `*_PROOF_URL` and sets this
 * inside its own `beforeAll` (`integration/planRegisterStore.test.ts`).
 */
const STORE_URL_VAR = "SLOPWEAVER_STORE_URL";
Reflect.deleteProperty(process.env, STORE_URL_VAR);

/** This test file's sandbox home — minted in `beforeAll`, removed in `afterAll`. */
let sandbox = "";

/** Every path currently under the sandbox, relative to it — files and directories alike. */
function sandboxEntries(): readonly string[] {
  return readdirSync(sandbox, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(sandbox.length + 1));
}

/**
 * This test file's sandboxed ACCOUNT home: what `accountDefaultHome()` answers instead of the operator's real
 * `~/.slopweaver`, which no environment variable moves. That home is the second registry the owner's protect list is
 * read from (`protectedPaths/ownerEntries.ts`), so without this every corpus reader and verb runner a test reaches
 * without an injected resolver reads the operator's own registry. Minted and installed at MODULE scope, so the test
 * module's own body already sees it and a stale slot a skipped previous file left in a reused worker is overwritten;
 * a sibling of the ambient sandbox, never the same directory, so a test writing a registry here is not reported as an
 * ambient write. A process slot, so a spawned `bin/slopweaver` child does NOT inherit it: the subprocess lane's
 * children still resolve the real account home, a residue no environment-free mechanism closes.
 */
const accountSandbox = mkdtempSync(join(tmpdir(), "slopweaver-account-home-"));
installAccountHomeSandbox({ home: accountSandbox });

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "slopweaver-ambient-home-"));
  process.env[HOME_VAR] = sandbox;
});

afterEach(() => {
  // The variable is restored unconditionally — a test is free to move it, and the next one must still be
  // isolated. Emptying the sandbox costs two syscalls per test, so it happens only when there is something
  // in it to empty: this hook runs once per test in a ~19,500-test lane.
  process.env[HOME_VAR] = sandbox;
  process.env[APP_SERVER_VAR] = absentAppServer;
  Reflect.deleteProperty(process.env, STORE_URL_VAR);
  // Emptied and reinstalled after every test, so one test's registry, lock or mark never reaches the next, and a test
  // that cleared or repointed the slot cannot leak that either.
  rmSync(accountSandbox, { force: true, recursive: true });
  mkdirSync(accountSandbox, { recursive: true });
  installAccountHomeSandbox({ home: accountSandbox });
  const refusal = ambientHomeRefusal({ writes: sandboxEntries() });
  if (refusal === undefined) {
    return;
  }
  // Clear the sandbox BEFORE throwing, so one offending test does not redden every test after it in the
  // same file — the report should name the test that actually wrote.
  rmSync(sandbox, { force: true, recursive: true });
  mkdirSync(sandbox, { recursive: true });
  throw new Error(refusal);
});

afterAll(() => {
  clearAccountHomeSandbox();
  rmSync(accountSandbox, { force: true, recursive: true });
  rmSync(sandbox, { force: true, recursive: true });
  restoreEnvironment({ snapshot: owned });
});
