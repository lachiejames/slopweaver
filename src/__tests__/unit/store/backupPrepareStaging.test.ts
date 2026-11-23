/**
 * Steps 1 to 3 of one backup, driven directly: `prepareStaging` makes a fresh staging directory, fills it with the
 * dump, the tar and the Vault leg, and writes the manifest describing them — and refuses a directory it did not
 * make, which is what keeps a planted `<instant>` entry from carrying tonight's plaintext anywhere.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { BackupErrors } from "../../../store/backup/errors.js";
import { BACKUP_FILES, BACKUP_MANIFEST_VERSION } from "../../../store/backup/plan.js";
import { prepareStaging } from "../../../store/backup/prepareStaging.js";
import type { BackupDeps } from "../../../store/backup/run.js";
import { stagingRoot } from "../../../store/backup/staging.js";

import {
  FAKE_STACK,
  FAKE_VAULT_BYTES,
  KEY,
  removeSandboxHomes,
  STORE_URL,
  sandboxHome,
  sha256Of,
} from "./backupRunWorld.js";

const NOW = "2026-11-04T03:00:00.000Z";

afterEach(() => {
  removeSandboxHomes();
});

describe("prepareStaging", () => {
  it("writes the dump, the tar, the Vault leg and a manifest describing all three", async () => {
    const home = sandboxHome();
    const directory = join(stagingRoot({ home }), "2026-11-04T03-00-00-000Z");
    const manifest = unwrap(
      await prepareStaging({
        masterPassword: null,
        deps: FAKE_STACK,
        directory,
        home,
        key: KEY,
        nowIso: NOW,
        storeUrl: STORE_URL,
      }),
    );
    expect(manifest.version).toBe(BACKUP_MANIFEST_VERSION);
    expect(manifest.createdAtIso).toBe(NOW);
    expect(manifest.pgDumpVersion).toBe("pg_dump (PostgreSQL) 17.6");
    expect(manifest.dump.sha256).toBe(sha256Of({ bytes: Buffer.from("PGDMP fake dump bytes") }));
    expect(manifest.storage.sha256).toBe(sha256Of({ bytes: Buffer.from("fake tar bytes") }));
    expect(manifest.vault!.sha256).toBe(sha256Of({ bytes: FAKE_VAULT_BYTES }));
    expect(readdirSync(directory).toSorted()).toEqual(
      [BACKUP_FILES.dump, BACKUP_FILES.manifest, BACKUP_FILES.storage, BACKUP_FILES.vault].toSorted(),
    );
  });

  it("records no Vault leg, and seals nothing, when there is no key", async () => {
    const home = sandboxHome();
    let sealed = 0;
    const deps: BackupDeps = {
      ...FAKE_STACK,
      sealVault: async (args) => {
        sealed += 1;
        return FAKE_STACK.sealVault(args);
      },
    };
    const directory = join(stagingRoot({ home }), "2026-11-04T03-00-00-000Z");
    const manifest = unwrap(
      await prepareStaging({
        masterPassword: null,
        deps,
        directory,
        home,
        key: null,
        nowIso: NOW,
        storeUrl: STORE_URL,
      }),
    );
    expect(manifest.vault).toBe(null);
    expect(sealed).toBe(0);
  });

  it("refuses a staging directory it did not make, writing nothing into it", async () => {
    const home = sandboxHome();
    const directory = join(stagingRoot({ home }), "2026-11-04T03-00-00-000Z");
    mkdirSync(directory, { recursive: true });
    const error = unwrapErr(
      await prepareStaging({
        masterPassword: null,
        deps: FAKE_STACK,
        directory,
        home,
        key: KEY,
        nowIso: NOW,
        storeUrl: STORE_URL,
      }),
    );
    expect(error).toEqual(
      BackupErrors.stepFailed({
        reasons: [`${directory} already exists; this run's staging must be made by this run — remove it and re-run`],
      }),
    );
    expect(readdirSync(directory)).toEqual([]);
  });

  it("refuses a store selection that is not a connection string before asking the stack anything", async () => {
    const home = sandboxHome();
    let asked = 0;
    const deps: BackupDeps = {
      ...FAKE_STACK,
      pgDumpVersion: () => {
        asked += 1;
        return FAKE_STACK.pgDumpVersion();
      },
    };
    const directory = join(stagingRoot({ home }), "2026-11-04T03-00-00-000Z");
    const result = await prepareStaging({
      masterPassword: null,
      deps,
      directory,
      home,
      key: KEY,
      nowIso: NOW,
      storeUrl: "not a url",
    });
    expect(unwrapErr(result)).toEqual(BackupErrors.storeUrlUnreadable());
    expect(asked).toBe(0);
    expect(existsSync(stagingRoot({ home }))).toBe(false);
  });
});
