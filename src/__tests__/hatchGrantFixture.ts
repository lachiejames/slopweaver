/**
 * A REAL journalled-hatch grant for a test, written where the code under test reads it.
 *
 * A journalled hatch opens on a grant in `sessions/hatch-grants.jsonl` naming the visible session, and on
 * nothing else — its `SLOPWEAVER_ALLOW_<SUFFIX>` variable opens nothing (`src/hatch/open.ts`). So a test that
 * proves a hatch still works appends the same row `slopweaver hatch open` would, under its own temp home, and
 * hands the code an environment naming that session and that home. No mock: the store and the lookup are the
 * shipped ones.
 *
 * Every grant here is issued at the REAL current instant, because most gates judge expiry against
 * `new Date()` themselves; thirty minutes is far longer than any test runs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHatchGrant } from "../hatch/grant.js";
import { appendHatchGrant } from "../hatch/grantStore.js";
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV } from "../supervisor/session.js";

/** The visible session every fixture grant is issued to unless a test names another. */
export const TEST_GRANT_SESSION = "a11ce000-0000-4000-8000-00000000beef";

/**
 * The environment a gate reads its grant through: the session that holds it, and the home it lives under.
 *
 * @param home the test's own temp state home
 * @param session the visible session the environment names
 * @returns an environment record a gate's injected `env` seam accepts
 */
export function grantSessionEnv({
  home,
  session = TEST_GRANT_SESSION,
}: {
  home: string;
  session?: string;
}): Readonly<Record<string, string>> {
  return { [CLAUDE_CODE_SESSION_ID_ENV]: session, SLOPWEAVER_HOME: home };
}

/**
 * Append one live grant per hatch id, issued to `session`, under `home`.
 *
 * @param home the test's own temp state home, where the grant journal is written
 * @param hatchIds the journalled register rows to open
 * @param session the visible session each grant names
 * @param issuedAtIso the instant each grant is taken — the wall clock unless the gate under test judges at a
 *   fixed `nowIso`, which must then be passed here: a grant is not live before it was issued
 * @returns the environment naming that session and home, ready to pass as the gate's `env`
 */
export function grantedEnv({
  home,
  hatchIds,
  session = TEST_GRANT_SESSION,
  issuedAtIso = new Date().toISOString(),
}: {
  home: string;
  hatchIds: readonly string[];
  session?: string;
  issuedAtIso?: string;
}): Readonly<Record<string, string>> {
  for (const hatchId of hatchIds) {
    appendHatchGrant({
      grant: buildHatchGrant({ claudeSessionId: session, hatchId, issuedAtIso, reason: "test fixture grant" }),
      home,
    });
  }
  return grantSessionEnv({ home, session });
}

/** The three process variables a grant check reads, which {@link withLiveGrant} sets and restores. */
const GRANT_PROCESS_VARIABLES = [CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV, "SLOPWEAVER_HOME"] as const;

/**
 * Run `run` with this PROCESS holding a live grant for each hatch id, restoring every variable it touched.
 *
 * For the few gates that read `process.env` with no injected seam — a Zod refinement such as
 * `updateArtifactSchema`'s truncated-send check has no parameter to take one. The grant is written under a
 * throwaway home the process is pointed at for `run` alone, so the ambient sandbox is never written, and both
 * that home and the three variables are put back however `run` exits.
 *
 * @param hatchIds the journalled register rows to open
 * @param run the assertion to make with the grant live
 */
export function withLiveGrant({ hatchIds, run }: { hatchIds: readonly string[]; run: () => void }): void {
  const before = GRANT_PROCESS_VARIABLES.map((name) => ({ name, value: process.env[name] }));
  const home = mkdtempSync(join(tmpdir(), "live-grant-"));
  try {
    grantedEnv({ hatchIds, home });
    process.env[CLAUDE_CODE_SESSION_ID_ENV] = TEST_GRANT_SESSION;
    delete process.env[CODEX_THREAD_ID_ENV];
    process.env["SLOPWEAVER_HOME"] = home;
    run();
  } finally {
    for (const { name, value } of before) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    rmSync(home, { force: true, recursive: true });
  }
}

/**
 * The one-name reader a door's injected `env` seam takes, over a record.
 *
 * @param env the record to read from
 * @returns a reader answering each name from `env`
 */
export function envReader({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): (args: { name: string }) => string | undefined {
  return ({ name }) => env[name];
}
