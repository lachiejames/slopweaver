/**
 * The store verbs read the committed migration journal from the tree this build lives in, never from the
 * directory the operator happens to be standing in — proved through the SHIPPED binary.
 *
 * Why the subprocess lane: the defect was a `cwd: process.cwd()` argument at the verb boundary, and a vitest
 * worker cannot `chdir`, so only a spawned process with a foreign `cwd` exercises the resolution for real.
 * MEASURED: from an empty temp directory,
 * `SLOPWEAVER_STORE_URL=postgresql://127.0.0.1:59999/nope slopweaver store verify` printed
 * `could not read the migration journal under <tmp>/supabase/migrations: ENOENT`.
 *
 * MEASURED again, and it is why this table is not all one verb: the two seats the finding came
 * from hit this on `knowledge recall` and `knowledge record`, not on a `store` verb. Those verbs reach the
 * journal through the SAME seam — `connectStore` `->` `readMigrationState` — so the extra cases are a
 * regression witness on one shared default rather than coverage of independent code paths, and adding a
 * tenth verb would prove nothing an eighth did not. `knowledge record` itself is NOT a usable case: its
 * four required flags fail argument parsing before the store is ever opened, so it would assert nothing.
 *
 * The static complement is the `store-journal-anchor` gate (`src/devLint/storeJournalAnchor.ts`), which
 * refuses a NEW call site reintroducing the anchor on a verb nobody thought to add here.
 *
 * The witness is two-sided, and falsifiable by construction: the journal is read BEFORE any connection is
 * attempted (`readMigrationState`, `src/store/lifecycle.ts`), so a refused connection is only ever reported
 * once the journal WAS read. The URL is a closed local port, so nothing here reaches a database.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const CLOSED_PORT_URL = "postgresql://127.0.0.1:59999/nope";

let foreignCwd: string;

beforeEach(() => {
  foreignCwd = mkdtempSync(join(tmpdir(), "slop-store-cwd-"));
});

afterEach(() => {
  rmSync(foreignCwd, { force: true, recursive: true });
});

/** Run one verb (and its flags) from a directory that carries no `supabase/migrations`, and capture stderr. */
function runFromForeignCwd({ args }: { args: readonly string[] }): { status: number; stderr: string } {
  try {
    execFileSync(BIN, args, {
      cwd: foreignCwd,
      encoding: "utf8",
      env: {
        ...accountSandboxChildEnv(),
        HOME: foreignCwd,
        PATH: process.env["PATH"]!,
        SLOPWEAVER_HOME: foreignCwd,
        SLOPWEAVER_STORE_URL: CLOSED_PORT_URL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (error: unknown) {
    const e = error as { status: number; stderr: string };
    return { status: e.status, stderr: e.stderr };
  }
}

describe("the store-backed verbs resolve the migration journal from the installed tree", () => {
  it.each([
    [["store", "verify"]],
    [["store", "status"]],
    [["store", "push", "--no-generate"]],
    [["knowledge", "recall", "datadog"]],
    [["knowledge", "list"]],
    [["atlas", "probe"]],
  ])("%j reads the journal and fails on the connection, not on ENOENT", (args) => {
    const result = runFromForeignCwd({ args });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("could not read the migration journal");
    expect(result.stderr).toContain("connect ECONNREFUSED 127.0.0.1:59999");
  });
});
