/**
 * The rehearsal's orchestration over plain fakes: a wrong target is refused before any download or container, a
 * started throwaway is stopped by the ID this run created, `--keep` leaves it running, and a throwaway reporting
 * a mount is stopped even under `--keep`. No Docker, no destination, no database.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { BACKUP_MANIFEST_VERSION, parseBackupManifest } from "../../../store/backup/plan.js";
import { type RehearsalDeps, runRehearsal } from "../../../store/backup/rehearsal.js";
import { RehearsalErrors } from "../../../store/backup/rehearsalErrors.js";
import { prepareRehearsal } from "../../../store/backup/rehearsalPrepare.js";
import type { LiveMount } from "../../../store/backup/rehearsalTarget.js";
import type { VerificationFacts } from "../../../store/backup/rehearsalVerify.js";
import { VaultErrors } from "../../../store/backup/vaultErrors.js";

const LIVE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const PREFIX = "slopweaver/2026-09-27T18-32-20-978Z/";
const LIVE_DATA: LiveMount = {
  destination: "/var/lib/postgresql/data",
  name: "supabase_db_slopweaver",
  source: "/var/lib/docker/volumes/supabase_db_slopweaver/_data",
};
const MANIFEST = unwrap(
  parseBackupManifest({
    value: {
      createdAtIso: "2026-09-27T18:32:20.978Z",
      database: "postgres",
      dump: { bytes: 1970000000, sha256: "1ce0c19a87cf5c60466f5ac2fca0ee2cc4dde08b1e30af44582f479e73212d9a" },
      extensions: [{ name: "pg_trgm", schema: "public" }],
      pgDumpVersion: "pg_dump (PostgreSQL) 17.6",
      project: "slopweaver",
      schemas: ["public", "drizzle", "storage"],
      secrets: null,
      storage: { bytes: 2048, sha256: "d31df497b8e4e16c29949797c81791c607b5a909ae889a33ddb22573b46bdc26" },
      vault: { bytes: 640, keyFingerprint: "0123456789abcdef", rows: 3, sha256: "e".repeat(64) },
      version: BACKUP_MANIFEST_VERSION,
    },
  }),
);

/** What the fake verification reads off both sides: one table, equal everywhere. */
const FACTS: VerificationFacts = {
  copyCatalog: ["relation public.a"],
  counts: [{ copy: 2, frontier: null, live: 2, table: "public.a" }],
  liveCatalog: ["relation public.a"],
  sample: {
    rows: [
      {
        copySha256: "aa",
        key: "1",
        liveSha256: "aa",
        liveTouchedAfterDump: false,
        table: "public.a",
        tableRecordsChanges: true,
      },
    ],
    unsampled: [],
  },
};

/** Every effect a fake run performed, in order. */
type Call = string;

/**
 * Fakes for every effect, recording each call.
 *
 * @param calls where each call is recorded
 * @param mounts what the started throwaway reports
 * @returns the deps
 */
function fakeDeps({ calls, mounts }: { calls: Call[]; mounts: readonly LiveMount[] }): RehearsalDeps {
  return {
    containerNameTaken: ({ name }) => {
      calls.push(`taken? ${name}`);
      return ok(false);
    },
    fetchSource: async ({ prefix }) => {
      calls.push(`fetch ${prefix}`);
      return ok({ destination: "/Volumes/Backup", directory: "/staging/retrieved/x", manifest: MANIFEST, prefix });
    },
    inspectLiveContainer: ({ container }) => {
      calls.push(`inspect ${container}`);
      return ok({ imageId: "sha256:live", mounts: [LIVE_DATA] });
    },
    listBackups: async ({ prefix }) => {
      calls.push(`list ${prefix}`);
      return ok([`${PREFIX}manifest.json`, "slopweaver/2026-09-26T18-00-00-000Z/manifest.json"]);
    },
    nowIso: () => "2026-09-28T10:00:00.000Z",
    readOtherLegs: async ({ directory }) => {
      calls.push(`legs ${directory}`);
      return ok({ files: { missing: [], named: 3 }, storage: { entries: 2, status: "listed" } });
    },
    restoreIntoThrowaway: ({ target, id }) => {
      calls.push(`restore into ${id}/${target.database}`);
      return ok("stack");
    },
    restoreVault: async ({ container, database, directory }) => {
      calls.push(`vault into ${container}/${database} from ${directory}`);
      return ok(undefined);
    },
    startThrowaway: ({ target }) => {
      calls.push(`start ${target.container} from ${target.imageId}`);
      return ok({ id: "c0ffee1234567890", mounts });
    },
    stopThrowaway: ({ id }) => {
      calls.push(`stop ${id}`);
      return ok(undefined);
    },
    vaultRowCount: ({ container }) => {
      calls.push(`count vault in ${container}`);
      return ok(3);
    },
    verify: async () => {
      calls.push("verify");
      return ok(FACTS);
    },
    waitForThrowaway: ({ id }) => {
      calls.push(`wait ${id}`);
      return ok(undefined);
    },
  };
}

const REQUEST = { container: "slopweaver_rehearsal_db", database: "slopweaver_rehearsal", port: 55422 };

describe("runRehearsal", () => {
  it("restores the newest backup into the throwaway, verifies it and stops it by ID", async () => {
    const calls: Call[] = [];
    const report = unwrap(
      await runRehearsal({
        deps: fakeDeps({ calls, mounts: [] }),
        destination: "/Volumes/Backup",
        from: null,
        keep: false,
        liveUrl: LIVE_URL,
        requested: REQUEST,
        sampleSize: 5,
      }),
    );
    expect(calls).toEqual([
      "inspect supabase_db_slopweaver",
      "taken? slopweaver_rehearsal_db",
      "list slopweaver/",
      `fetch ${PREFIX}`,
      "legs /staging/retrieved/x",
      "start slopweaver_rehearsal_db from sha256:live",
      "wait c0ffee1234567890",
      "restore into c0ffee1234567890/slopweaver_rehearsal",
      "verify",
      "vault into c0ffee1234567890/slopweaver_rehearsal from /staging/retrieved/x",
      "count vault in c0ffee1234567890",
      "stop c0ffee1234567890",
    ]);
    expect(report.verdict).toEqual({ failures: [], passed: true });
    expect(report.vault).toEqual({ expected: 3, restored: 3, status: "restored" });
    expect(report.source.prefix).toBe(PREFIX);
    expect(report.throwaway.kept).toBe(false);
  });

  it("fails the rehearsal, still stopping the throwaway, when the Vault leg does not restore", async () => {
    const calls: Call[] = [];
    const deps: RehearsalDeps = {
      ...fakeDeps({ calls, mounts: [] }),
      restoreVault: async () => err(VaultErrors.targetNotEmpty({ rows: 2 })),
    };
    const report = unwrap(
      await runRehearsal({
        deps,
        destination: "/Volumes/Backup",
        from: null,
        keep: false,
        liveUrl: LIVE_URL,
        requested: REQUEST,
        sampleSize: 5,
      }),
    );
    expect(report.vault).toEqual({
      status: "failed",
      why: "the restore target's vault.secrets already holds 2 row(s); an import would sit beside them, so nothing was imported",
    });
    expect(report.verdict.passed).toBe(false);
    expect(calls.includes("count vault in c0ffee1234567890")).toBe(false);
    expect(calls.at(-1)).toBe("stop c0ffee1234567890");
  });

  it("refuses the live database name before inspecting anything past the live container", async () => {
    const calls: Call[] = [];
    const error = unwrapErr(
      await runRehearsal({
        deps: fakeDeps({ calls, mounts: [] }),
        destination: "/Volumes/Backup",
        from: null,
        keep: false,
        liveUrl: LIVE_URL,
        requested: { ...REQUEST, database: "postgres" },
        sampleSize: 5,
      }),
    );
    expect(error.code).toBe("REHEARSAL_TARGET_IS_LIVE");
    expect(calls).toEqual(["inspect supabase_db_slopweaver"]);
  });

  it("refuses a container name already taken, and never stops or removes it", async () => {
    const calls: Call[] = [];
    const deps: RehearsalDeps = {
      ...fakeDeps({ calls, mounts: [] }),
      containerNameTaken: () => ok(true),
    };
    const error = unwrapErr(
      await runRehearsal({
        deps,
        destination: "/b",
        from: null,
        keep: false,
        liveUrl: LIVE_URL,
        requested: REQUEST,
        sampleSize: 5,
      }),
    );
    expect(error).toEqual(RehearsalErrors.containerExists({ container: "slopweaver_rehearsal_db" }));
    expect(calls).toEqual(["inspect supabase_db_slopweaver"]);
  });

  it("leaves the throwaway running under --keep", async () => {
    const calls: Call[] = [];
    const report = unwrap(
      await runRehearsal({
        deps: fakeDeps({ calls, mounts: [] }),
        destination: "/Volumes/Backup",
        from: PREFIX,
        keep: true,
        liveUrl: LIVE_URL,
        requested: REQUEST,
        sampleSize: 5,
      }),
    );
    expect(calls.filter((call) => call.startsWith("stop") || call.startsWith("list"))).toEqual([]);
    expect(report.throwaway.kept).toBe(true);
  });

  it("stops a throwaway that reports a mount, even under --keep, and restores nothing into it", async () => {
    const calls: Call[] = [];
    const error = unwrapErr(
      await runRehearsal({
        deps: fakeDeps({ calls, mounts: [LIVE_DATA] }),
        destination: "/Volumes/Backup",
        from: PREFIX,
        keep: true,
        liveUrl: LIVE_URL,
        requested: REQUEST,
        sampleSize: 5,
      }),
    );
    expect(error.message).toContain("the live store's data directory");
    expect(calls.slice(-2)).toEqual(["start slopweaver_rehearsal_db from sha256:live", "stop c0ffee1234567890"]);
  });

  it("stops the throwaway when the restore fails", async () => {
    const calls: Call[] = [];
    const deps: RehearsalDeps = {
      ...fakeDeps({ calls, mounts: [] }),
      restoreIntoThrowaway: () => err(RehearsalErrors.stepFailed({ reasons: ["exit 1"], step: "pg_restore" })),
    };
    const error = unwrapErr(
      await runRehearsal({
        deps,
        destination: "/b",
        from: PREFIX,
        keep: false,
        liveUrl: LIVE_URL,
        requested: REQUEST,
        sampleSize: 5,
      }),
    );
    expect(error.message).toBe("pg_restore: exit 1");
    expect(calls.at(-1)).toBe("stop c0ffee1234567890");
  });

  it("stops the throwaway when verification throws", async () => {
    const calls: Call[] = [];
    const deps: RehearsalDeps = {
      ...fakeDeps({ calls, mounts: [] }),
      verify: async () => {
        throw new Error("connection refused");
      },
    };
    const error = unwrapErr(
      await runRehearsal({
        deps,
        destination: "/b",
        from: PREFIX,
        keep: false,
        liveUrl: LIVE_URL,
        requested: REQUEST,
        sampleSize: 5,
      }),
    );
    expect(error.message).toBe("restoring and verifying the throwaway: connection refused");
    expect(calls.at(-1)).toBe("stop c0ffee1234567890");
  });

  it("refuses a store selection with no explicit port", async () => {
    const calls: Call[] = [];
    const error = unwrapErr(
      await runRehearsal({
        deps: fakeDeps({ calls, mounts: [] }),
        destination: "/b",
        from: null,
        keep: false,
        liveUrl: "postgresql://postgres@localhost/postgres",
        requested: REQUEST,
        sampleSize: 5,
      }),
    );
    expect(error.code).toBe("REHEARSAL_LIVE_UNREADABLE");
    expect(calls).toEqual([]);
  });
});

describe("prepareRehearsal", () => {
  it("settles live, the target, the fetched backup and its other legs, and starts no container", async () => {
    const calls: Call[] = [];
    const prepared = unwrap(
      await prepareRehearsal({
        deps: fakeDeps({ calls, mounts: [] }),
        destination: "/Volumes/Backup",
        from: null,
        liveUrl: LIVE_URL,
        requested: REQUEST,
      }),
    );
    expect(calls).toEqual([
      "inspect supabase_db_slopweaver",
      "taken? slopweaver_rehearsal_db",
      "list slopweaver/",
      `fetch ${PREFIX}`,
      "legs /staging/retrieved/x",
    ]);
    expect(prepared.live.port).toBe(55322);
    expect(prepared.live.imageId).toBe("sha256:live");
    expect(prepared.target.container).toBe("slopweaver_rehearsal_db");
    expect(prepared.source.prefix).toBe(PREFIX);
    expect(prepared.legs.files).toEqual({ missing: [], named: 3 });
  });

  it("refuses a store selection that is not a connection string, inspecting nothing", async () => {
    const calls: Call[] = [];
    const error = unwrapErr(
      await prepareRehearsal({
        deps: fakeDeps({ calls, mounts: [] }),
        destination: "/b",
        from: null,
        liveUrl: "not a url",
        requested: REQUEST,
      }),
    );
    expect(error).toEqual(
      RehearsalErrors.liveUnreadable({ reasons: ["the store selection is not a connection string"] }),
    );
    expect(calls).toEqual([]);
  });
});
