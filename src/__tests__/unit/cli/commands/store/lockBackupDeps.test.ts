/**
 * The pre-lock backup's verdict on a stack other than `slopweaver`, whose containers the dump cannot address, and
 * the usage lines `store lock | start` print.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { foreignStackBackup, lockCopyLegs } from "../../../../../cli/commands/store/lockBackupDeps.js";
import { LOCK_USAGE, START_USAGE } from "../../../../../cli/commands/store/lockUsage.js";
import { isEmptyStore } from "../../../../../store/lock/backupGate.js";

const URL_ON_ACME = "postgresql://slopweaver_verbs:pw@127.0.0.1:56522/acme%2Dstore";

describe("foreignStackBackup", () => {
  it("passes an empty stack as empty, naming its decoded database", () => {
    const outcome = foreignStackBackup({
      counts: { ownedTables: 0, storageBuckets: 0, storageObjects: 0 },
      currentUrl: URL_ON_ACME,
      projectId: "acme",
    });
    expect(unwrap(outcome)).toEqual({ database: "acme-store", kind: "empty" });
  });

  it("refuses a stack holding a table, since its containers cannot be dumped", () => {
    const error = unwrapErr(
      foreignStackBackup({
        counts: { ownedTables: 1, storageBuckets: 0, storageObjects: 0 },
        currentUrl: URL_ON_ACME,
        projectId: "acme",
      }),
    );
    expect(error.code).toBe("BACKUP_GATE_FAILED");
    expect(error.message).toContain("the acme stack is not empty");
  });

  it("refuses a stack holding only Storage objects", () => {
    const error = unwrapErr(
      foreignStackBackup({
        counts: { ownedTables: 0, storageBuckets: 0, storageObjects: 3 },
        currentUrl: URL_ON_ACME,
        projectId: "acme",
      }),
    );
    expect(error.code).toBe("BACKUP_GATE_FAILED");
  });

  it("refuses a stack holding only an empty Storage bucket", () => {
    const error = unwrapErr(
      foreignStackBackup({
        counts: { ownedTables: 0, storageBuckets: 1, storageObjects: 0 },
        currentUrl: URL_ON_ACME,
        projectId: "acme",
      }),
    );
    expect(error.code).toBe("BACKUP_GATE_FAILED");
  });
});

describe("isEmptyStore", () => {
  it.each([
    { counts: { ownedTables: 0, storageBuckets: 0, storageObjects: 0 }, empty: true },
    { counts: { ownedTables: 1, storageBuckets: 0, storageObjects: 0 }, empty: false },
    { counts: { ownedTables: 0, storageBuckets: 1, storageObjects: 0 }, empty: false },
    { counts: { ownedTables: 0, storageBuckets: 0, storageObjects: 1 }, empty: false },
  ])("reads $counts as empty: $empty", ({ counts, empty }) => {
    expect(isEmptyStore({ counts })).toBe(empty);
  });
});

describe("lockCopyLegs", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A throwaway copy directory. */
  function copy(): string {
    const dir = mkdtempSync(join(tmpdir(), "lockcopy-"));
    dirs.push(dir);
    return dir;
  }

  it("reads the copy's files leg as naming nothing, since the lock writes none", () => {
    const legs = unwrap(lockCopyLegs({ directory: copy() }));
    expect(legs.files).toEqual({ missing: [], named: 0 });
    expect(legs.storage.status).toBe("unreadable");
  });

  it("refuses a directory holding a files.json, which is not the copy the gate wrote", () => {
    const directory = copy();
    writeFileSync(join(directory, "files.json"), "{}");
    const error = unwrapErr(lockCopyLegs({ directory }));
    expect(error.message).toContain("which the pre-lock copy never writes");
  });
});

describe("the lock's usage lines", () => {
  it.each([
    { usage: LOCK_USAGE, verb: "lock" },
    { usage: START_USAGE, verb: "start" },
  ])("store $verb opens on its own verb and names every flag it parses", ({ usage, verb }) => {
    expect(usage.startsWith(`usage: slopweaver store ${verb} `)).toBe(true);
    expect(["--rotate", "--workdir", "--home", "--json"].filter((flag) => !usage.includes(flag))).toEqual([]);
  });
});
