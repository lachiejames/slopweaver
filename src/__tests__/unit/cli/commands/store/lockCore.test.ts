/**
 * `store lock | start`'s pure half: the flags, the report lines, and the lines `store verify` adds. The report
 * never carries a password or a URL.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  lockLines,
  lockMeasurementLines,
  parseLockArgs,
  pinnedStart,
} from "../../../../../cli/commands/store/lockCore.js";
import type { LockReport } from "../../../../../store/lock/reconcile.js";

const REPORT: LockReport = {
  backup: null,
  database: "slopweaver",
  evicted: 0,
  gateway: "172.18.0.1",
  hbaRewritten: false,
  password: "keep",
  projectId: "acme",
  proofs: ["postgres:postgres is refused by the rule at 127.0.0.1"],
  storeUrlWritten: false,
};

describe("parseLockArgs", () => {
  it("reads every flag", () => {
    expect(
      unwrap(parseLockArgs({ rest: ["--rotate", "--json", "--workdir", "/checkout", "--home", "/home/acme"] })),
    ).toEqual({
      home: "/home/acme",
      json: true,
      rotate: true,
      workdir: "/checkout",
    });
  });

  it("defaults to no rotation, this checkout and the ambient home", () => {
    expect(unwrap(parseLockArgs({ rest: [] }))).toEqual({
      home: undefined,
      json: false,
      rotate: false,
      workdir: undefined,
    });
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseLockArgs({ rest: ["--force"] })).join(" ")).toContain("--force");
  });
});

describe("lockLines", () => {
  it("reports a re-run that changed nothing", () => {
    expect(lockLines({ report: REPORT })).toEqual([
      "store lock: acme stack, database slopweaver, Mac logins arrive from 172.18.0.1",
      "store lock: no pre-lock backup taken — the login role carries the mark of the backup the first lock verified, and that copy is not re-checked",
      "store lock: login — keep, secrets/store-url unchanged",
      "store lock: pg_hba.conf already carried the rule",
      "store lock: ✓ postgres:postgres is refused by the rule at 127.0.0.1",
    ]);
  });

  it("reports a first run's backup, rewrite and eviction", () => {
    const lines = lockLines({
      report: {
        ...REPORT,
        backup: { database: "postgres", kind: "empty" },
        evicted: 2,
        hbaRewritten: true,
        password: "create",
        storeUrlWritten: true,
      },
    });
    expect(lines.slice(1, 5)).toEqual([
      "store lock: nothing to back up — postgres holds no table in public or drizzle and no Storage bucket or object",
      "store lock: login — create, secrets/store-url rewritten",
      "store lock: pg_hba.conf rewritten",
      "store lock: ended 2 session(s) from the Mac that were not the login",
    ]);
  });
});

describe("lockMeasurementLines", () => {
  it("says why the lock was not measured", () => {
    expect(
      lockMeasurementLines({ measurement: { notMeasured: "the store is selected by SLOPWEAVER_STORE_URL" } }),
    ).toEqual(["store verify: lock not measured — the store is selected by SLOPWEAVER_STORE_URL"]);
  });

  it("lists what held, then what did not", () => {
    expect(
      lockMeasurementLines({
        measurement: { findings: ["postgres:postgres is NOT refused"], held: ["the login works"] },
      }),
    ).toEqual(["store verify: lock ✓ the login works", "store verify: lock ✗ postgres:postgres is NOT refused"]);
  });
});

describe("pinnedStart", () => {
  it("runs the checkout's pinned launcher by path, without PostgREST, and drops every variable that steers which binary it runs", () => {
    const start = pinnedStart({
      env: { HOME: "/Users/acme", SUPABASE_ACCESS_TOKEN: "kept", SUPABASE_CLI_BINARY_PATH: "/tmp/other" },
      nodePath: "/usr/local/bin/node",
      treeRoot: "/checkout",
      workdir: "/checkout",
    });
    expect(start).toEqual({
      args: [
        "/checkout/node_modules/supabase/dist/supabase.js",
        "start",
        "--workdir",
        "/checkout",
        "--exclude",
        "postgrest",
      ],
      command: "/usr/local/bin/node",
      env: { HOME: "/Users/acme", SUPABASE_ACCESS_TOKEN: "kept" },
    });
  });
});
