/**
 * `runRestore`'s two refusals before anything is written: a backup directory whose payload no longer matches its
 * manifest, and a Vault leg there is no backup key to open. Each is asserted to reach no stack effect at all — a
 * restore that created its target database first would leave a half-restored copy behind either refusal.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { BackupErrors } from "../../../store/backup/errors.js";
import { keyFingerprint } from "../../../store/backup/objectCrypto.js";
import { BACKUP_FILES } from "../../../store/backup/plan.js";
import { prepareStaging } from "../../../store/backup/prepareStaging.js";
import { type RestoreDeps, runRestore } from "../../../store/backup/restore.js";
import { digestFile } from "../../../store/backup/stack.js";
import { stagingRoot } from "../../../store/backup/staging.js";

import { FAKE_STACK, KEY, removeSandboxHomes, STORE_URL, sandboxHome } from "./backupRunWorld.js";

afterEach(() => {
  removeSandboxHomes();
});

/**
 * Deps whose every stack effect records its name and then stops the test, so a refusal that reached one fails
 * loudly; only the digest is real, because verifying the directory is the step under test.
 *
 * @param calls where each reached effect is recorded
 * @returns the deps
 */
function unreachableStack({ calls }: { calls: string[] }): RestoreDeps {
  const reached =
    ({ name }: { name: string }) =>
    (): never => {
      calls.push(name);
      throw new Error(`${name} was reached`);
    };
  return {
    createDatabase: reached({ name: "createDatabase" }),
    createExtension: reached({ name: "createExtension" }),
    databaseExists: reached({ name: "databaseExists" }),
    digestFile,
    dropDatabase: reached({ name: "dropDatabase" }),
    listArchive: reached({ name: "listArchive" }),
    restoreDatabase: reached({ name: "restoreDatabase" }),
    restoreVault: reached({ name: "restoreVault" }),
    tableCounts: reached({ name: "tableCounts" }),
    targetShape: reached({ name: "targetShape" }),
    untarStorage: reached({ name: "untarStorage" }),
  };
}

/**
 * A staged backup carrying a Vault leg, as the nightly run leaves it.
 *
 * @returns the staging directory
 */
async function stagedBackup(): Promise<string> {
  const home = sandboxHome();
  const directory = join(stagingRoot({ home }), "2026-11-04T03-00-00-000Z");
  unwrap(
    await prepareStaging({
      deps: FAKE_STACK,
      directory,
      home,
      key: KEY,
      masterPassword: null,
      nowIso: "2026-11-04T03:00:00.000Z",
      storeUrl: STORE_URL,
    }),
  );
  return directory;
}

const RESTORE = {
  database: "slopweaver_restored",
  dropAfter: false,
  liveUrl: null,
  restoredUrl: "postgresql://postgres@127.0.0.1:54322/slopweaver_restored",
  restoreStorage: false,
} as const;

describe("runRestore", () => {
  it("refuses a Vault leg it has no backup key for, before reaching the stack", async () => {
    const directory = await stagedBackup();
    const calls: string[] = [];
    const error = unwrapErr(
      await runRestore({
        ...RESTORE,
        deps: unreachableStack({ calls }),
        key: null,
        source: { directory, kind: "directory" },
      }),
    );
    expect(error).toEqual(
      BackupErrors.stepFailed({
        reasons: [
          `this backup's Vault leg is sealed under backup key ${keyFingerprint({ key: KEY })}, and no backup key was read`,
        ],
      }),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a directory whose dump no longer matches its manifest, before reaching the stack", async () => {
    const directory = await stagedBackup();
    appendFileSync(join(directory, BACKUP_FILES.dump), "tampered");
    const calls: string[] = [];
    const error = unwrapErr(
      await runRestore({
        ...RESTORE,
        deps: unreachableStack({ calls }),
        key: KEY,
        source: { directory, kind: "directory" },
      }),
    );
    expect(error.message).toContain(BACKUP_FILES.dump);
    expect(calls).toEqual([]);
  });
});
