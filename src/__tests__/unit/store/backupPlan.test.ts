/**
 * The pure half of the store backup — names, the manifest, the restore decisions, and the one constant
 * that must agree with a file outside `src/`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { CHUNKING } from "../../../store/backup/chunkBoundaries.js";
import { BackupErrors, backupErrorLines } from "../../../store/backup/errors.js";
import {
  BACKUP_MANIFEST_VERSION,
  backupDirectoryName,
  backupPrefix,
  blobObjectName,
  blobPrefix,
  blobsHeld,
  DUMPED_SCHEMAS,
  databaseNameOf,
  objectNameFor,
  parseBackupManifest,
  parseFilesManifest,
  SUPABASE_PROJECT_ID,
  stagingToPrune,
  supabaseContainer,
  validateDatabaseName,
  withDatabase,
} from "../../../store/backup/plan.js";
import { compareCounts, filterRestoreToc, restoreModeFor } from "../../../store/backup/restorePlan.js";

const MANIFEST = {
  createdAtIso: "2026-09-14T03:00:00.000Z",
  database: "postgres",
  dump: { bytes: 282464403, sha256: "1ce0c19a87cf5c60466f5ac2fca0ee2cc4dde08b1e30af44582f479e73212d9a" },
  extensions: [{ name: "pg_trgm", schema: "public" }],
  pgDumpVersion: "pg_dump (PostgreSQL) 17.6",
  project: "slopweaver",
  schemas: ["public", "drizzle", "storage"],
  secrets: { bytes: 912, sha256: "0d4b1e5e7b4a5c2f8e6a1d9c3b7f0a2e4d6c8b0a2e4d6c8b0a2e4d6c8b0a2e4d" },
  storage: { bytes: 2048, sha256: "d31df497b8e4e16c29949797c81791c607b5a909ae889a33ddb22573b46bdc26" },
  version: 1,
};

const VAULT = { bytes: 640, keyFingerprint: "0123456789abcdef", rows: 3, sha256: "e".repeat(64) };

describe("the container names follow the Supabase CLI and the repository's own config", () => {
  it("pins SUPABASE_PROJECT_ID to supabase/config.toml", () => {
    const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");
    const declared = /^project_id = "([^"]+)"/m.exec(config)?.[1];
    expect(declared).toBe(SUPABASE_PROJECT_ID);
  });

  it("names the db, kong and storage containers the way `docker ps` shows them", () => {
    expect(supabaseContainer({ service: "db" })).toBe("supabase_db_slopweaver");
    expect(supabaseContainer({ service: "kong" })).toBe("supabase_kong_slopweaver");
    expect(supabaseContainer({ service: "storage" })).toBe("supabase_storage_slopweaver");
  });

  it("dumps exactly the owned schemas", () => {
    expect([...DUMPED_SCHEMAS]).toEqual(["public", "drizzle", "storage"]);
  });
});

describe("the store selection's database name", () => {
  it("reads the path of the connection string", () => {
    expect(unwrap(databaseNameOf({ url: "postgresql://postgres:pw@127.0.0.1:55322/postgres" }))).toBe("postgres");
  });

  it("refuses a string with no database", () => {
    const result = databaseNameOf({ url: "postgresql://postgres:pw@127.0.0.1:55322/" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(BackupErrors.storeDatabaseMissing());
    expect(unwrapErr(result).message).toBe("the store selection names no database in its path");
  });

  it("refuses a non-URL", () => {
    expect(unwrapErr(databaseNameOf({ url: "not a url" }))).toEqual(BackupErrors.storeUrlUnreadable());
    expect(unwrapErr(databaseNameOf({ url: "not a url" })).message).toBe(
      "the store selection is not a URL a database name can be read from",
    );
  });

  it("re-points the same credential at another database", () => {
    expect(
      unwrap(
        withDatabase({ database: "store_restore_proof", url: "postgresql://postgres:pw@127.0.0.1:55322/postgres" }),
      ),
    ).toBe("postgresql://postgres:pw@127.0.0.1:55322/store_restore_proof");
  });

  it("only creates a plain lower-case identifier", () => {
    expect(unwrap(validateDatabaseName({ name: "store_restore_proof" }))).toBe("store_restore_proof");
    expect(validateDatabaseName({ name: "Proof" }).isErr()).toBe(true);
    expect(validateDatabaseName({ name: "a;drop" }).isErr()).toBe(true);
    expect(validateDatabaseName({ name: "" }).isErr()).toBe(true);
  });
});

describe("names in the destination and on disk", () => {
  it("keeps colons and dots out of the directory name and still sorts by time", () => {
    expect(backupDirectoryName({ createdAtIso: "2026-09-14T03:00:00.000Z" })).toBe("2026-09-14T03-00-00-000Z");
    const earlier = backupDirectoryName({ createdAtIso: "2026-09-13T23:59:59.999Z" });
    const later = backupDirectoryName({ createdAtIso: "2026-09-14T00:00:00.000Z" });
    expect([later, earlier].toSorted()).toEqual([earlier, later]);
  });

  it("prefixes by project then instant, with a trailing slash", () => {
    const prefix = backupPrefix({ createdAtIso: "2026-09-14T03:00:00.000Z", project: "slopweaver" });
    expect(prefix).toBe("slopweaver/2026-09-14T03-00-00-000Z/");
    expect(objectNameFor({ file: "dump", prefix })).toBe("slopweaver/2026-09-14T03-00-00-000Z/store.dump");
    expect(objectNameFor({ file: "manifest", prefix })).toBe("slopweaver/2026-09-14T03-00-00-000Z/manifest.json");
  });
});

describe("the manifest", () => {
  it("reads a version-1 manifest's dump as one object, which is what every backup before chunking was", () => {
    expect(unwrap(parseBackupManifest({ value: MANIFEST }))).toEqual({
      ...MANIFEST,
      dump: { ...MANIFEST.dump, chunked: null },
      vault: null,
    });
  });

  it("round-trips the shape a backup writes, its dump's chunk list included", () => {
    const chunked = {
      chunking: CHUNKING,
      chunks: [
        { bytes: 4194304, sha256: "a".repeat(64) },
        { bytes: 1024, sha256: "b".repeat(64) },
      ],
      encoding: "identity",
    };
    const written = {
      ...MANIFEST,
      dump: { ...MANIFEST.dump, chunked },
      vault: VAULT,
      version: BACKUP_MANIFEST_VERSION,
    };
    expect(unwrap(parseBackupManifest({ value: written }))).toEqual(written);
  });

  it("will not read a version-3 manifest that leaves vault unsaid, nor an older one that says it", () => {
    const unsaid = parseBackupManifest({ value: { ...MANIFEST, version: BACKUP_MANIFEST_VERSION } });
    const early = parseBackupManifest({ value: { ...MANIFEST, vault: VAULT, version: 2 } });
    expect(backupErrorLines({ error: unwrapErr(unsaid) })).toEqual([
      "vault: a version-3 manifest must say vault, null or not",
    ]);
    expect(backupErrorLines({ error: unwrapErr(early) })).toEqual(["vault: a version-2 manifest carries no vault"]);
  });

  it("refuses a chunk list cut by a rule this build does not know", () => {
    const chunked = { chunking: "fastcdc-2m-8m-16m-v9", chunks: [], encoding: "identity" };
    const result = parseBackupManifest({ value: { ...MANIFEST, dump: { ...MANIFEST.dump, chunked }, version: 2 } });
    expect(
      backupErrorLines({ error: unwrapErr(result) }).some((line) => line.startsWith("dump.chunked.chunking:")),
    ).toBe(true);
  });

  it("carries `secrets: null` when the credentials leg did not run, and will not accept the field missing", () => {
    expect(unwrap(parseBackupManifest({ value: { ...MANIFEST, secrets: null } })).secrets).toBe(null);
    const { secrets, ...withoutSecrets } = MANIFEST;
    const absent = parseBackupManifest({ value: withoutSecrets });
    expect(absent.isErr()).toBe(true);
    expect(backupErrorLines({ error: unwrapErr(absent) }).some((line) => line.startsWith("secrets:"))).toBe(true);
  });

  it("refuses a version it does not know, naming the field", () => {
    const result = parseBackupManifest({ value: { ...MANIFEST, version: 4 } });
    expect(result.isErr()).toBe(true);
    expect(backupErrorLines({ error: unwrapErr(result) }).some((line) => line.startsWith("version:"))).toBe(true);
  });

  it("refuses a digest that is not hex", () => {
    const result = parseBackupManifest({ value: { ...MANIFEST, dump: { bytes: 1, sha256: "nope" } } });
    expect(result.isErr()).toBe(true);
    expect(backupErrorLines({ error: unwrapErr(result) }).some((line) => line.startsWith("dump.sha256:"))).toBe(true);
  });
});

describe("files.json", () => {
  const entry = ({ relativePath }: { relativePath: string }) => ({ bytes: 1, relativePath, sha256: "a".repeat(64) });
  const manifestOf = ({ paths }: { paths: readonly string[] }) => ({
    createdAtIso: "2026-09-27T03:02:01.526Z",
    files: paths.map((relativePath) => entry({ relativePath })),
    roots: ["corpus"],
    version: 2,
  });

  it("reads the paths the walk writes", () => {
    const parsed = unwrap(parseFilesManifest({ value: manifestOf({ paths: ["corpus/a.jsonl", "knowledge/b"] }) }));
    expect(parsed.files.map((file) => file.relativePath)).toEqual(["corpus/a.jsonl", "knowledge/b"]);
  });

  it.each(["dir/../a", "../outside", "/etc/passwd", "a/./b", ".."])(
    "refuses %s, which a restore would write outside the root or to another entry's file",
    (path) => {
      const lines = backupErrorLines({
        error: unwrapErr(parseFilesManifest({ value: manifestOf({ paths: [path] }) })),
      });
      expect(lines.some((line) => line.includes("a relativePath must be normalised and inside the root"))).toBe(true);
    },
  );

  it("refuses two entries naming the same path", () => {
    const lines = backupErrorLines({
      error: unwrapErr(parseFilesManifest({ value: manifestOf({ paths: ["a", "a"] }) })),
    });
    expect(lines.some((line) => line.includes("two entries name the same relativePath"))).toBe(true);
  });

  it("refuses one file digest recorded at two lengths", () => {
    const value = {
      ...manifestOf({ paths: ["a"] }),
      files: [entry({ relativePath: "a" }), { ...entry({ relativePath: "b" }), bytes: 2 }],
    };
    const lines = backupErrorLines({ error: unwrapErr(parseFilesManifest({ value })) });
    expect(lines.some((line) => line.includes("a file digest is recorded at two lengths"))).toBe(true);
  });

  it("refuses one chunk digest recorded at two lengths", () => {
    const chunk = { bytes: 1, sha256: "b".repeat(64) };
    const chunked = { chunking: CHUNKING, chunks: [chunk, { ...chunk, bytes: 2 }], encoding: "identity" };
    const value = { ...manifestOf({ paths: [] }), files: [{ ...entry({ relativePath: "a" }), chunked }] };
    const lines = backupErrorLines({ error: unwrapErr(parseFilesManifest({ value })) });
    expect(lines.some((line) => line.includes("a chunk digest is recorded at two lengths"))).toBe(true);
  });

  it("reads one digest repeated at one length", () => {
    const chunk = { bytes: 1, sha256: "b".repeat(64) };
    const chunked = { chunking: CHUNKING, chunks: [chunk, chunk], encoding: "identity" };
    const value = {
      ...manifestOf({ paths: ["b"] }),
      files: [entry({ relativePath: "a" }), { ...entry({ relativePath: "c" }), chunked }],
    };
    expect(unwrap(parseFilesManifest({ value })).files.length).toBe(2);
  });
});

describe("restoring", () => {
  it("drops only the public schema entry from the table of contents", () => {
    const toc = [
      ";",
      "; Archive created at 2026-09-14 03:00:00 UTC",
      "18; 2615 1032903 SCHEMA - drizzle postgres",
      "20; 2615 2200 SCHEMA - public postgres",
      "33; 2615 16505 SCHEMA - storage supabase_admin",
      "246; 1259 1819023 TABLE public content postgres",
    ].join("\n");
    expect(filterRestoreToc({ toc })).toEqual([
      ";",
      "; Archive created at 2026-09-14 03:00:00 UTC",
      "18; 2615 1032903 SCHEMA - drizzle postgres",
      "33; 2615 16505 SCHEMA - storage supabase_admin",
      "246; 1259 1819023 TABLE public content postgres",
    ]);
  });

  it("refuses a target that already holds a store", () => {
    const result = restoreModeFor({ hasStorageSchema: true, publicTables: 8 });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(BackupErrors.restoreTargetNotEmpty({ publicTables: 8 }));
    expect(unwrapErr(result).message).toContain("already holds 8 table(s) in public");
  });

  it("picks empty mode for a database created here and stack mode for a fresh supabase database", () => {
    expect(unwrap(restoreModeFor({ hasStorageSchema: false, publicTables: 0 }))).toBe("empty");
    expect(unwrap(restoreModeFor({ hasStorageSchema: true, publicTables: 0 }))).toBe("stack");
  });

  it("compares counts table by table and treats a missing table as a difference", () => {
    const same = compareCounts({
      live: [{ rows: 3, table: "public.content" }],
      restored: [{ rows: 3, table: "public.content" }],
    });
    expect(same.identical).toBe(true);
    const missing = compareCounts({
      live: [
        { rows: 3, table: "public.content" },
        { rows: 0, table: "storage.objects" },
      ],
      restored: [{ rows: 3, table: "public.content" }],
    });
    expect(missing.identical).toBe(false);
    expect(missing.tables).toEqual([
      { live: 3, restored: 3, table: "public.content" },
      { live: 0, restored: null, table: "storage.objects" },
    ]);
  });
});

describe("pruning staged copies", () => {
  it("keeps the newest eligible copies and every copy some destination is still owed", () => {
    const staged = [
      { eligible: true, name: "2026-09-11T03-00-00-000Z" },
      { eligible: false, name: "2026-09-12T03-00-00-000Z" },
      { eligible: true, name: "2026-09-13T03-00-00-000Z" },
      { eligible: true, name: "2026-09-14T03-00-00-000Z" },
    ];
    expect(stagingToPrune({ keep: 1, staged })).toEqual(["2026-09-11T03-00-00-000Z", "2026-09-13T03-00-00-000Z"]);
    expect(stagingToPrune({ keep: 3, staged })).toEqual([]);
  });
});

describe("blobsHeld", () => {
  const files = [
    { bytes: 10, relativePath: "corpus/bodies/a.json", sha256: "aaa" },
    { bytes: 20, relativePath: "corpus/bodies/b.json", sha256: "bbb" },
    { bytes: 30, relativePath: "corpus/bodies/c.json", sha256: "ccc" },
  ];
  const project = SUPABASE_PROJECT_ID;

  it("holds a blob listed at exactly its measured length, and nothing else", () => {
    const sizes = new Map([
      [blobObjectName({ project, sha256: "aaa" }), 10],
      [blobObjectName({ project, sha256: "bbb" }), 21],
    ]);
    expect([...blobsHeld({ files, project, sizes })]).toEqual(["aaa"]);
  });

  it("holds nothing from an empty listing", () => {
    expect(blobsHeld({ files, project, sizes: new Map() }).size).toBe(0);
  });

  it("ignores a listed name under another project", () => {
    const sizes = new Map([[blobObjectName({ project: "elsewhere", sha256: "aaa" }), 10]]);
    expect(blobsHeld({ files, project, sizes }).size).toBe(0);
  });

  it("names every blob under the prefix it lists", () => {
    expect(blobObjectName({ project, sha256: "aaa" })).toBe(`${blobPrefix({ project })}aaa`);
    expect(blobPrefix({ project })).toBe(`${project}/blobs/`);
  });
});
