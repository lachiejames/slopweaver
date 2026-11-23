/**
 * The pre-lock backup gate, over plain fakes for every stack effect: an empty store skips, a failed step refuses the
 * lock before anything is written, and a copy that does not rehearse refuses it with the copy kept under the home.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";

import { BackupErrors } from "../../../../store/backup/errors.js";
import { verifyBackupDirectory } from "../../../../store/backup/restoreSource.js";
import { digestFile } from "../../../../store/backup/stack.js";
import {
  type LockBackupDeps,
  parseContentCounts,
  STORE_CONTENT_COUNTS_QUERY,
  takeLockBackup,
} from "../../../../store/lock/backupGate.js";
import { StoreLockErrors } from "../../../../store/lock/errors.js";

const STORE_URL = "postgresql://slopweaver_verbs:pw@127.0.0.1:55322/slopweaver";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "lockgate-"));
  dirs.push(dir);
  return dir;
}

/**
 * Fakes for a store holding one table: the dump and tar write real bytes, the digests and the manifest check are the
 * real ones, and the rehearsal is whatever the case hands in.
 */
function deps({ over = {} }: { over?: Partial<LockBackupDeps> } = {}): LockBackupDeps {
  return {
    contentCounts: () => ok({ ownedTables: 1, storageBuckets: 0, storageObjects: 0 }),
    digestFile,
    dumpDatabase: ({ path }) => {
      writeFileSync(path, "-- dump\n");
      return ok(undefined);
    },
    listExtensions: () => ok([]),
    nowIso: () => "2026-11-07T00:00:00.000Z",
    pgDumpVersion: () => ok("pg_dump (PostgreSQL) 17.4"),
    rehearse: async () => err(StoreLockErrors.backupGateFailed({ reasons: ["the rehearsal stopped: no docker"] })),
    storageObjects: () => ok([]),
    tarStorage: ({ path }) => {
      writeFileSync(path, "");
      return ok(undefined);
    },
    unpackAndDigest: () => ok([]),
    verifyBackupDirectory,
    ...over,
  };
}

describe("the store's content counts", () => {
  it("are read in one statement, so one snapshot answers all three", () => {
    expect(STORE_CONTENT_COUNTS_QUERY.includes(";")).toBe(false);
    expect(STORE_CONTENT_COUNTS_QUERY.match(/count\(\*\)/g)!.length).toBe(3);
  });

  it("parse tables, buckets and objects from psql's one line", () => {
    expect(unwrap(parseContentCounts({ out: "2|1|40\n" }))).toEqual({
      ownedTables: 2,
      storageBuckets: 1,
      storageObjects: 40,
    });
  });

  it.each(["", "0|0", "0||0", "0|0|0|0", "a|0|0", "-1|0|0"])("refuse %j rather than reading it as zero", (out) => {
    const error = unwrapErr(parseContentCounts({ out }));
    expect(error.message).toContain("counting what the store holds");
  });
});

describe("takeLockBackup", () => {
  it("skips an empty store, naming its database, and writes nothing", async () => {
    const root = home();
    const outcome = await takeLockBackup({
      deps: deps({ over: { contentCounts: () => ok({ ownedTables: 0, storageBuckets: 0, storageObjects: 0 }) } }),
      home: root,
      storeUrl: STORE_URL,
    });
    expect(unwrap(outcome)).toEqual({ database: "slopweaver", kind: "empty" });
    expect(existsSync(join(root, "store-lock"))).toBe(false);
  });

  it("copies a store whose only state is an empty Storage bucket, rather than calling it empty", async () => {
    const root = home();
    const error = unwrapErr(
      await takeLockBackup({
        deps: deps({ over: { contentCounts: () => ok({ ownedTables: 0, storageBuckets: 1, storageObjects: 0 }) } }),
        home: root,
        storeUrl: STORE_URL,
      }),
    );
    // The fake rehearsal refuses, so reaching it is the witness that the copy was taken rather than skipped.
    expect(error.message).toContain("the rehearsal stopped: no docker");
    expect(readdirSync(join(root, "store-lock", "backups")).length).toBe(1);
  });

  it("refuses the lock on a failed step before any copy directory exists", async () => {
    const root = home();
    const error = unwrapErr(
      await takeLockBackup({
        deps: deps({ over: { pgDumpVersion: () => err(BackupErrors.stepFailed({ reasons: ["pg_dump is gone"] })) } }),
        home: root,
        storeUrl: STORE_URL,
      }),
    );
    expect(error.code).toBe("BACKUP_GATE_FAILED");
    expect(error.message).toContain("pg_dump is gone");
    expect(existsSync(join(root, "store-lock"))).toBe(false);
  });

  it("refuses the lock when the copy does not rehearse, keeping the copy under store-lock/backups", async () => {
    const root = home();
    const error = unwrapErr(await takeLockBackup({ deps: deps(), home: root, storeUrl: STORE_URL }));
    expect(error.code).toBe("BACKUP_GATE_FAILED");
    expect(error.message).toContain("the rehearsal stopped: no docker");
    const [copy] = readdirSync(join(root, "store-lock", "backups"));
    expect(readdirSync(join(root, "store-lock", "backups", copy!)).toSorted()).toEqual([
      "manifest.json",
      "storage.tar",
      "store.dump",
    ]);
  });
});
