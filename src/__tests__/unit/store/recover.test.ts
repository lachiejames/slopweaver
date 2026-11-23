/**
 * `store recover`'s sequence over plain fakes. The order is the design, so the tests assert the ORDER: the stack
 * is checked before anything is downloaded, the roles exist before `pg_restore`, the master password is read and the
 * bundle decrypted before the twenty-minute restore, and a re-run resumes from its marker rather than repeating.
 * No Docker, no destination, no database, no disk.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { BackupManifest } from "../../../store/backup/plan.js";
import { BACKUP_MANIFEST_VERSION, SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import { type RecoverRequest, runRecover } from "../../../store/backup/recover.js";
import { RecoverErrors } from "../../../store/backup/recoverErrors.js";
import type { RecoverMarker } from "../../../store/backup/recoverPlan.js";
import type { DerivedSecret } from "../../../store/backup/recoverSecrets.js";
import { installLine, type RecoverDeps } from "../../../store/backup/recoverSteps.js";
import { BACKUP_PASSPHRASE_SECRET } from "../../../store/backup/secretsBundle.js";
import { STORE_URL_SECRET } from "../../../store/config.js";

const PREFIX = "slopweaver/2026-09-29T17-12-51-910Z/";
const URL_RECOVERED = "postgresql://postgres:postgres@127.0.0.1:55322/store_recovered";
const NOW = "2026-09-30T02:00:00.000Z";
const PASSWORD = "abcdefghijklmnopqrstuvwxyz";

/**
 * A verified manifest, with or without a credentials bundle.
 *
 * @param carried whether the machine that took it had a `backup-passphrase` set
 * @returns the manifest
 */
function manifest({ carried }: { carried: boolean }): BackupManifest {
  return {
    createdAtIso: "2026-09-29T17:12:51.910Z",
    database: "postgres",
    dump: { bytes: 1, chunked: null, sha256: "a".repeat(64) },
    extensions: [],
    pgDumpVersion: "pg_dump (PostgreSQL) 17.6",
    project: SUPABASE_PROJECT_ID,
    schemas: ["public"],
    secrets: carried ? { bytes: 1, sha256: "c".repeat(64) } : null,
    storage: { bytes: 1, sha256: "b".repeat(64) },
    vault: null,
    version: BACKUP_MANIFEST_VERSION,
  };
}

const REQUEST: RecoverRequest = {
  database: "store_recovered",
  dryRun: false,
  from: null,
  home: "/home/recovered",
  homeStoreDatabase: "postgres",
  stagingFor: ({ prefix }) => ok(`/staging/${prefix.replace(/\/+$/, "").replace(/\//g, "_")}`),
  treeRoot: "/checkout",
  url: URL_RECOVERED,
};

const STAGING = "/staging/slopweaver_2026-09-29T17-12-51-910Z";

/** What one fake run is set up to find. */
interface World {
  readonly running: boolean;
  readonly carried: boolean;
  /** Tables in the recovered database's `public` schema. */
  readonly publicTables: number;
  /** Tables in the `public` schema of `postgres`, the database the home's `store-url` names. */
  readonly homeStoreTables: number;
  readonly marker: RecoverMarker | null;
  readonly fileConflicts: readonly string[];
  readonly decryptFails: boolean;
  /** The backup is a staging directory read in place rather than a destination fetch. */
  readonly localSource: boolean;
}

const EMPTY_WORLD: World = {
  carried: false,
  decryptFails: false,
  fileConflicts: [],
  homeStoreTables: 0,
  localSource: false,
  marker: null,
  publicTables: 0,
  running: true,
};

/** What a fake run recorded: every effect in order, and the credentials it was asked to install. */
interface Recorded {
  readonly calls: string[];
  readonly derived: DerivedSecret[][];
  readonly names: (readonly string[])[];
  readonly markers: RecoverMarker[];
}

/**
 * Fakes for every effect over one world, recording each call.
 *
 * @param world what the run finds
 * @param recorded where each call is recorded
 * @returns the deps
 */
function fakeDeps({ world, recorded }: { world: World; recorded: Recorded }): RecoverDeps {
  const source = {
    directory: `${STAGING}/retrieved`,
    kind: "local-destination" as const,
    prefix: PREFIX,
    root: "/Volumes/Backup",
  };
  return {
    authoredRestore: async ({ home, url }) => {
      recorded.calls.push(`authored ${home} ${url}`);
      return ok(undefined);
    },
    chooseBackup: async ({ from }) => {
      recorded.calls.push(`choose ${String(from)}`);
      return ok(PREFIX);
    },
    clearStaging: ({ path }) => {
      recorded.calls.push(`clear ${path}`);
    },
    createRoles: () => {
      recorded.calls.push("roles");
      return ok(undefined);
    },
    decryptSecrets: ({ into, passphrase }) => {
      recorded.calls.push(`decrypt ${into} ${passphrase}`);
      return world.decryptFails
        ? err(RecoverErrors.stepFailed({ reasons: ["wrong passphrase"], step: "decrypting the credentials" }))
        : ok(["slack-bot-token", STORE_URL_SECRET]);
    },
    fetchSource: async ({ prefix }) => {
      recorded.calls.push(`fetch ${prefix}`);
      return ok(world.localSource ? { directory: "/backups/local", kind: "directory" as const } : source);
    },
    installFiles: ({ staged, home }) => {
      recorded.calls.push(`install files ${staged} → ${home}`);
      return ok({ conflicts: world.fileConflicts, identical: 0, replaced: [], written: 3 });
    },
    installSecrets: ({ staged, names, derived, home }) => {
      recorded.calls.push(`install secrets ${staged} → ${home}`);
      recorded.names.push(names);
      recorded.derived.push([...derived]);
      return ok({ conflicts: [], identical: 0, replaced: [], written: names.length + derived.length });
    },
    migrate: async ({ url }) => {
      recorded.calls.push(`migrate ${url}`);
      return ok(undefined);
    },
    nowIso: () => NOW,
    progress: () => undefined,
    publicTables: ({ database }) => {
      recorded.calls.push(`tables ${database}`);
      return ok(database === "postgres" ? world.homeStoreTables : world.publicTables);
    },
    readMarker: ({ path }) => {
      recorded.calls.push(`read marker ${path}`);
      return world.marker;
    },
    masterPassword: async () => {
      recorded.calls.push("password");
      return PASSWORD;
    },
    restoreDatabase: async ({ database }) => {
      recorded.calls.push(`restore ${database}`);
      return ok(undefined);
    },
    restoreFiles: async ({ into }) => {
      recorded.calls.push(`files ${into}`);
      return ok(3);
    },
    stackRunning: () => {
      recorded.calls.push("stack?");
      return ok(world.running);
    },
    verifySource: () => {
      recorded.calls.push("verify");
      return ok(manifest({ carried: world.carried }));
    },
    writeMarker: ({ marker }) => {
      recorded.markers.push(marker);
      recorded.calls.push("write marker");
      return ok(undefined);
    },
  };
}

/**
 * A fresh record of one run.
 *
 * @returns an empty record
 */
function recording(): Recorded {
  return { calls: [], derived: [], markers: [], names: [] };
}

describe("runRecover", () => {
  it("refuses with the start command when the stack is down, and does nothing else", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, running: false } }),
      request: REQUEST,
    });

    expect(unwrapErr(result)).toEqual(
      RecoverErrors.stackDown({ container: "supabase_db_slopweaver", treeRoot: "/checkout" }),
    );
    expect(recorded.calls).toEqual(["stack?"]);
  });

  it("stops before reading a marker or clearing anything when its staging cannot be made", async () => {
    const recorded = recording();
    const refused = RecoverErrors.stepFailed({ reasons: ["a link below the staging root"], step: "making staging" });

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: EMPTY_WORLD }),
      request: { ...REQUEST, stagingFor: () => err(refused) },
    });

    expect(unwrapErr(result)).toEqual(refused);
    expect(recorded.calls).toEqual(["stack?", "choose null"]);
  });

  it("a dry run chooses the backup and writes nothing", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: EMPTY_WORLD }),
      request: { ...REQUEST, dryRun: true },
    });

    expect(unwrap(result).dryRun).toBe(true);
    expect(recorded.calls).toEqual(["stack?", "choose null", `read marker ${STAGING}/marker.json`, "tables postgres"]);
  });

  it("refuses to repoint a store-url naming a database that holds a store, before anything is downloaded", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, homeStoreTables: 40 } }),
      request: REQUEST,
    });

    expect(unwrapErr(result)).toEqual(
      RecoverErrors.homeStoreInUse({ current: "postgres", recovered: "store_recovered" }),
    );
    expect(recorded.calls).toEqual(["stack?", "choose null", `read marker ${STAGING}/marker.json`, "tables postgres"]);
  });

  it("a dry run names that refusal too, so it is met before the real run", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, homeStoreTables: 40 } }),
      request: { ...REQUEST, dryRun: true },
    });

    expect(unwrapErr(result).code).toBe("RECOVER_HOME_STORE_IN_USE");
  });

  it("never asks about the home's database when the URL came from the environment", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, homeStoreTables: 40 } }),
      request: { ...REQUEST, dryRun: true, homeStoreDatabase: null },
    });

    expect(unwrap(result).dryRun).toBe(true);
    expect(recorded.calls.includes("tables postgres")).toBe(false);
  });

  it("recovers a wiped home in order, installing the master password even from a backup without credentials", async () => {
    const recorded = recording();

    const result = await runRecover({ deps: fakeDeps({ recorded, world: EMPTY_WORLD }), request: REQUEST });

    expect(recorded.calls).toEqual([
      "stack?",
      "choose null",
      `read marker ${STAGING}/marker.json`,
      "tables postgres",
      "roles",
      "tables store_recovered",
      `fetch ${PREFIX}`,
      "verify",
      "password",
      "restore store_recovered",
      "write marker",
      `migrate ${URL_RECOVERED}`,
      `clear ${STAGING}/files`,
      `files ${STAGING}/files`,
      `install files ${STAGING}/files → /home/recovered`,
      "write marker",
      `install secrets ${STAGING}/secrets → /home/recovered`,
      "write marker",
      `authored /home/recovered ${URL_RECOVERED}`,
      `clear ${STAGING}/retrieved`,
    ]);
    expect(recorded.derived).toEqual([
      [
        { name: STORE_URL_SECRET, replaceDatabaseOnly: true, value: URL_RECOVERED },
        { name: BACKUP_PASSPHRASE_SECRET, replaceDatabaseOnly: false, value: PASSWORD },
      ],
    ]);
    expect(unwrap(result)).toEqual({
      complete: true,
      conflicts: [],
      credentialsCarried: false,
      database: "store_recovered",
      dryRun: false,
      files: { conflicts: [], identical: 0, replaced: [], written: 3 },
      prefix: PREFIX,
      secrets: { conflicts: [], identical: 0, replaced: [], written: 2 },
    });
  });

  it("hands a store-url derived from the environment to the install without authority to replace", async () => {
    const recorded = recording();

    await runRecover({
      deps: fakeDeps({ recorded, world: EMPTY_WORLD }),
      request: { ...REQUEST, homeStoreDatabase: null },
    });

    expect(recorded.derived).toEqual([
      [
        { name: STORE_URL_SECRET, replaceDatabaseOnly: false, value: URL_RECOVERED },
        { name: BACKUP_PASSPHRASE_SECRET, replaceDatabaseOnly: false, value: PASSWORD },
      ],
    ]);
  });

  it("decrypts the credentials BEFORE the database restore, and installs the master password beside them", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, carried: true } }),
      request: REQUEST,
    });

    const calls = recorded.calls;
    expect(calls.indexOf("password")).toBeLessThan(calls.indexOf("restore store_recovered"));
    expect(calls.indexOf(`decrypt ${STAGING}/secrets ${PASSWORD}`)).toBeLessThan(
      calls.indexOf("restore store_recovered"),
    );
    expect(recorded.names).toEqual([["slack-bot-token"]]);
    expect(recorded.derived).toEqual([
      [
        { name: STORE_URL_SECRET, replaceDatabaseOnly: true, value: URL_RECOVERED },
        { name: BACKUP_PASSPHRASE_SECRET, replaceDatabaseOnly: false, value: PASSWORD },
      ],
    ]);
    expect(unwrap(result).credentialsCarried).toBe(true);
  });

  it("a wrong passphrase stops the run before the database is touched", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, carried: true, decryptFails: true } }),
      request: REQUEST,
    });

    expect(unwrapErr(result)).toEqual(
      RecoverErrors.stepFailed({ reasons: ["wrong passphrase"], step: "decrypting the credentials" }),
    );
    expect(recorded.calls.includes("restore store_recovered")).toBe(false);
  });

  it("a re-run after a finished recovery downloads nothing and re-runs only the idempotent tail", async () => {
    const recorded = recording();
    const marker: RecoverMarker = {
      database: "store_recovered",
      databaseRestoredAtIso: NOW,
      filesRestoredAtIso: NOW,
      prefix: PREFIX,
      secretsInstalledAtIso: NOW,
    };

    // The first run repointed store-url, so the home already names the recovered database and nothing is asked.
    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, marker, publicTables: 40 } }),
      request: { ...REQUEST, homeStoreDatabase: "store_recovered" },
    });

    expect(recorded.calls).toEqual([
      "stack?",
      "choose null",
      `read marker ${STAGING}/marker.json`,
      "roles",
      "tables store_recovered",
      `migrate ${URL_RECOVERED}`,
      `authored /home/recovered ${URL_RECOVERED}`,
    ]);
    expect(unwrap(result)).toEqual({
      complete: true,
      conflicts: [],
      credentialsCarried: null,
      database: "store_recovered",
      dryRun: false,
      files: null,
      prefix: PREFIX,
      secrets: null,
    });
  });

  it("a re-run after a restore that died in the files leg skips the database and finishes the rest", async () => {
    const recorded = recording();
    const marker: RecoverMarker = {
      database: "store_recovered",
      databaseRestoredAtIso: NOW,
      filesRestoredAtIso: null,
      prefix: PREFIX,
      secretsInstalledAtIso: null,
    };

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, marker, publicTables: 40 } }),
      request: REQUEST,
    });

    expect(recorded.calls.includes(`fetch ${PREFIX}`)).toBe(true);
    expect(recorded.calls.includes("restore store_recovered")).toBe(false);
    expect(recorded.markers.at(-1)).toEqual({ ...marker, filesRestoredAtIso: NOW, secretsInstalledAtIso: NOW });
    expect(unwrap(result).complete).toBe(true);
  });

  it("refuses a database already holding a store no recovery restored, before downloading", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, publicTables: 40 } }),
      request: REQUEST,
    });

    expect(unwrapErr(result)).toEqual(RecoverErrors.databaseHoldsStore({ database: "store_recovered" }));
    expect(recorded.calls.at(-1)).toBe("tables store_recovered");
  });

  it("a file the home holds with different bytes leaves the run incomplete and the files step unmarked", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, fileConflicts: ["profile.json"] } }),
      request: REQUEST,
    });

    const report = unwrap(result);
    expect(report.complete).toBe(false);
    expect(report.conflicts).toEqual(["profile.json"]);
    expect(recorded.markers.map((marker) => marker.filesRestoredAtIso)).toEqual([null, null]);
    expect(recorded.calls.includes(`clear ${STAGING}/retrieved`)).toBe(false);
  });
});

describe("runRecover's cleanup", () => {
  it("never removes a local backup directory it was handed, only a destination fetch", async () => {
    const recorded = recording();

    const result = await runRecover({
      deps: fakeDeps({ recorded, world: { ...EMPTY_WORLD, localSource: true } }),
      request: REQUEST,
    });

    expect(unwrap(result).complete).toBe(true);
    expect(recorded.calls.includes("clear /backups/local")).toBe(false);
    expect(recorded.calls.at(-1)).toBe(`authored /home/recovered ${URL_RECOVERED}`);
  });
});

describe("installLine", () => {
  it("names every count, conflicts included", () => {
    expect(installLine({ report: { conflicts: ["a", "b"], identical: 4, replaced: [], written: 7 } })).toBe(
      "7 written, 4 already identical, 2 left in staging because the home holds different bytes",
    );
  });

  it("names a replacement when one was made", () => {
    const replaced = [{ newDatabase: "store_recovered", oldDatabase: "postgres", path: "secrets/store-url" as const }];

    expect(installLine({ report: { conflicts: [], identical: 3, replaced, written: 1 } })).toBe(
      "1 written, 1 replaced, 3 already identical, 0 left in staging because the home holds different bytes",
    );
  });
});
