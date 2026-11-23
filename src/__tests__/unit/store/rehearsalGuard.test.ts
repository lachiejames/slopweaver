/**
 * The restore rehearsal's guard: a target naming any live coordinate is refused before anything runs, a started
 * throwaway reporting any mount is refused, the `docker run` argv carries no mount and binds loopback only, and
 * the newest finished backup is the one picked.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseMounts } from "../../../store/backup/rehearsalDocker.js";
import { RehearsalErrors } from "../../../store/backup/rehearsalErrors.js";
import { newestBackupPrefix } from "../../../store/backup/rehearsalSource.js";
import {
  DEFAULT_REHEARSAL_CONTAINER,
  DEFAULT_REHEARSAL_DATABASE,
  DEFAULT_REHEARSAL_PORT,
  type LiveStore,
  rehearsalTarget,
  throwawayMountsClear,
  throwawayRunArgs,
  throwawayUrl,
} from "../../../store/backup/rehearsalTarget.js";

const LIVE: LiveStore = {
  container: "supabase_db_slopweaver",
  database: "postgres",
  imageId: "sha256:4f1c0ffee",
  mounts: [
    {
      destination: "/var/lib/postgresql/data",
      name: "supabase_db_slopweaver",
      source: "/var/lib/docker/volumes/supabase_db_slopweaver/_data",
    },
  ],
  port: 55322,
};

const DEFAULT_REQUEST = {
  container: DEFAULT_REHEARSAL_CONTAINER,
  database: DEFAULT_REHEARSAL_DATABASE,
  port: DEFAULT_REHEARSAL_PORT,
};

describe("rehearsalTarget refuses every live coordinate", () => {
  it("accepts the defaults and pins the live image ID", () => {
    const target = unwrap(rehearsalTarget({ live: LIVE, requested: DEFAULT_REQUEST }));
    expect(target.database).toBe("slopweaver_rehearsal");
    expect(target.port).toBe(55422);
    expect(target.container).toBe("slopweaver_rehearsal_db");
    expect(target.imageId).toBe("sha256:4f1c0ffee");
  });

  it("refuses the live database name", () => {
    const error = unwrapErr(rehearsalTarget({ live: LIVE, requested: { ...DEFAULT_REQUEST, database: "postgres" } }));
    expect(error.code).toBe("REHEARSAL_TARGET_IS_LIVE");
    expect(error.message).toContain("--into postgres is the live store's database name (port 55322)");
  });

  it("refuses the live port", () => {
    const error = unwrapErr(rehearsalTarget({ live: LIVE, requested: { ...DEFAULT_REQUEST, port: 55322 } }));
    expect(error.message).toContain("--port 55322 is the live store's port");
  });

  it("refuses the live container and any other container of the live stack", () => {
    const db = unwrapErr(
      rehearsalTarget({ live: LIVE, requested: { ...DEFAULT_REQUEST, container: "supabase_db_slopweaver" } }),
    );
    const storage = unwrapErr(
      rehearsalTarget({ live: LIVE, requested: { ...DEFAULT_REQUEST, container: "supabase_storage_slopweaver" } }),
    );
    expect(db.message).toContain("--container supabase_db_slopweaver is a container of the live Supabase stack");
    expect(storage.message).toContain(
      "--container supabase_storage_slopweaver is a container of the live Supabase stack",
    );
  });

  it("names every collision at once", () => {
    const error = unwrapErr(
      rehearsalTarget({
        live: LIVE,
        requested: { container: "supabase_db_slopweaver", database: "postgres", port: 55322 },
      }),
    );
    expect(error).toEqual(
      RehearsalErrors.targetIsLive({
        collisions: [
          "--into postgres is the live store's database name (port 55322)",
          "--port 55322 is the live store's port",
          "--container supabase_db_slopweaver is a container of the live Supabase stack",
        ],
      }),
    );
  });
});

describe("throwawayMountsClear refuses any mount on the throwaway", () => {
  it("passes a throwaway with no mounts", () => {
    expect(throwawayMountsClear({ live: LIVE, mounts: [] }).isOk()).toBe(true);
  });

  it("names a mount of the live data directory as that", () => {
    const error = unwrapErr(throwawayMountsClear({ live: LIVE, mounts: LIVE.mounts }));
    expect(error.message).toContain(
      "the throwaway mounts /var/lib/docker/volumes/supabase_db_slopweaver/_data at /var/lib/postgresql/data, the live store's data directory",
    );
  });

  it("refuses an anonymous volume too", () => {
    const error = unwrapErr(
      throwawayMountsClear({
        live: LIVE,
        mounts: [
          { destination: "/var/lib/postgresql/data", name: "3a9f", source: "/var/lib/docker/volumes/3a9f/_data" },
        ],
      }),
    );
    expect(error.message).toContain("and a throwaway is started with none");
  });
});

describe("the throwaway's argv and URL", () => {
  const target = unwrap(rehearsalTarget({ live: LIVE, requested: DEFAULT_REQUEST }));

  it("runs detached and --rm, binds loopback only, carries no mount flag, and names the password without valuing it", () => {
    const args = throwawayRunArgs({ target });
    expect(args).toEqual([
      "run",
      "--detach",
      "--rm",
      "--name",
      "slopweaver_rehearsal_db",
      "--publish",
      "127.0.0.1:55422:5432",
      "--env",
      "POSTGRES_PASSWORD",
      "sha256:4f1c0ffee",
    ]);
    expect(args.filter((arg) => arg.includes("="))).toEqual([]);
    expect(args.filter((arg) => arg === "-v" || arg === "--volume" || arg === "--mount")).toEqual([]);
  });

  it("connects to the throwaway's own port and database", () => {
    expect(throwawayUrl({ password: "p/w", target })).toBe(
      "postgresql://postgres:p%2Fw@127.0.0.1:55422/slopweaver_rehearsal",
    );
  });
});

describe("parseMounts", () => {
  it("reads docker's mounts, a bind mount's empty name as null", () => {
    const text =
      '[{"Type":"volume","Name":"supabase_db_slopweaver","Source":"/var/lib/docker/volumes/supabase_db_slopweaver/_data","Destination":"/var/lib/postgresql/data"},' +
      '{"Type":"bind","Source":"/host/init","Destination":"/docker-entrypoint-initdb.d"}]';
    expect(parseMounts({ text })).toEqual([
      {
        destination: "/var/lib/postgresql/data",
        name: "supabase_db_slopweaver",
        source: "/var/lib/docker/volumes/supabase_db_slopweaver/_data",
      },
      { destination: "/docker-entrypoint-initdb.d", name: null, source: "/host/init" },
    ]);
  });

  it("reads a Name that is not a string as no name, never as a refusal", () => {
    expect(parseMounts({ text: '[{"Name":null,"Source":"/s","Destination":"/d"}]' })).toEqual([
      { destination: "/d", name: null, source: "/s" },
    ]);
  });

  it("reads an empty list", () => {
    expect(parseMounts({ text: "[]" })).toEqual([]);
  });

  it("refuses text that is not docker's shape", () => {
    expect(parseMounts({ text: "null" })).toBe(null);
    expect(parseMounts({ text: '[{"Source":1}]' })).toBe(null);
    expect(parseMounts({ text: "not json" })).toBe(null);
  });
});

describe("newestBackupPrefix", () => {
  it("takes the lexically greatest instant that carries a manifest", () => {
    const objectNames = [
      "slopweaver/2026-09-26T18-00-00-000Z/manifest.json",
      "slopweaver/2026-09-27T18-32-20-978Z/manifest.json",
      "slopweaver/2026-09-27T18-32-20-978Z/storage.tar",
      "slopweaver/2026-09-28T03-00-00-000Z/storage.tar",
      "slopweaver/blobs/ab/abcdef",
      "slopweaver/chunks/zstd/0123",
    ];
    expect(newestBackupPrefix({ objectNames, project: "slopweaver" })).toBe("slopweaver/2026-09-27T18-32-20-978Z/");
  });

  it("answers null when no instant carries a manifest", () => {
    expect(newestBackupPrefix({ objectNames: ["slopweaver/blobs/ab/abcdef"], project: "slopweaver" })).toBe(null);
    expect(newestBackupPrefix({ objectNames: [], project: "slopweaver" })).toBe(null);
  });

  it("ignores another project's backups", () => {
    const objectNames = [
      "other/2026-09-28T03-00-00-000Z/manifest.json",
      "slopweaver/2026-09-01T03-00-00-000Z/manifest.json",
    ];
    expect(newestBackupPrefix({ objectNames, project: "slopweaver" })).toBe("slopweaver/2026-09-01T03-00-00-000Z/");
  });
});
