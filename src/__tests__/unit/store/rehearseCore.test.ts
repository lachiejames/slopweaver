/**
 * `store rehearse`'s pure half — the parser, the rendered report and the knowledge row's words — the verb's exits
 * that come before any home or destination, the record the monitor reads, round-tripped through a temp home, and the
 * monitor's verdict over it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import {
  parseStoreRehearseArgs,
  passedOrFailedRecord,
  rehearsalLesson,
  rehearsalLines,
} from "../../../cli/commands/store/rehearseCore.js";
import { runStoreRehearse } from "../../../cli/commands/store/rehearseRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { GENERIC_STANDING_ROWS } from "../../../live/automation/standingRows.js";
import { evaluateStoreRehearsal } from "../../../monitor/storeRehearsal.js";
import { compareSchema, judgeRehearsal } from "../../../store/backup/rehearsalCheck.js";
import {
  readRehearsalRecord,
  rehearsalRecordPath,
  writeRehearsalRecord,
} from "../../../store/backup/rehearsalRecord.js";
import type { RehearsalReport } from "../../../store/backup/rehearsalReport.js";

const SCHEMA = compareSchema({ copy: ["relation public.a"], live: ["relation public.a"] });
const COUNTS = [{ copy: 2, frontier: null, live: 3, table: "public.a", verdict: "drifted" as const }];
const SAMPLE = [{ key: "1", table: "public.a", verdict: "equal" as const }];
const LEGS = { files: { missing: [], named: 3 }, storage: { entries: 2, status: "listed" as const } };
const VAULT = { expected: 4, restored: 4, status: "restored" as const };

const REPORT: RehearsalReport = {
  counts: COUNTS,
  finishedAtIso: "2026-09-28T10:05:00.000Z",
  legs: LEGS,
  live: {
    container: "supabase_db_slopweaver",
    database: "postgres",
    imageId: "sha256:0123456789abcdef0123",
    port: 55322,
  },
  restoreMode: "stack",
  restoreSeconds: 41,
  sample: SAMPLE,
  schema: SCHEMA,
  source: {
    createdAtIso: "2026-09-27T18:32:20.978Z",
    destination: "/Volumes/Backup",
    dumpBytes: 1970000000,
    dumpSha256: "1ce0c19a87cf5c60466f5ac2fca0ee2cc4dde08b1e30af44582f479e73212d9a",
    prefix: "slopweaver/2026-09-27T18-32-20-978Z/",
  },
  startedAtIso: "2026-09-28T10:00:00.000Z",
  throwaway: {
    container: "slopweaver_rehearsal_db",
    database: "slopweaver_rehearsal",
    id: "c0ffee1234567890",
    kept: false,
    mounts: 0,
    port: 55422,
  },
  unsampled: [],
  vault: VAULT,
  verdict: judgeRehearsal({ counts: COUNTS, legs: LEGS, sample: SAMPLE, schema: SCHEMA, vault: VAULT }),
};

describe("parseStoreRehearseArgs", () => {
  it("defaults to the throwaway coordinates and records the proof", () => {
    expect(unwrap(parseStoreRehearseArgs({ rest: [] }))).toEqual({
      destination: null,
      from: null,
      json: false,
      keep: false,
      record: true,
      requested: { container: "slopweaver_rehearsal_db", database: "slopweaver_rehearsal", port: 55422 },
      sampleSize: 5,
    });
  });

  it("takes every flag", () => {
    const args = unwrap(
      parseStoreRehearseArgs({
        rest: [
          "--from",
          "slopweaver/2026-09-27T18-32-20-978Z/",
          "--into",
          "r2",
          "--port",
          "55433",
          "--container",
          "r2_db",
          "--sample-size",
          "20",
          "--keep",
          "--no-record",
          "--json",
          "--home",
          "/h",
          "--destination",
          "/Volumes/Backup",
        ],
      }),
    );
    expect(args).toEqual({
      destination: "/Volumes/Backup",
      from: "slopweaver/2026-09-27T18-32-20-978Z/",
      home: "/h",
      json: true,
      keep: true,
      record: false,
      requested: { container: "r2_db", database: "r2", port: 55433 },
      sampleSize: 20,
    });
  });

  it("parses the live database name — the refusal is the engine's, against the live store it reads", () => {
    expect(unwrap(parseStoreRehearseArgs({ rest: ["--into", "postgres"] })).requested.database).toBe("postgres");
  });

  it("refuses a bad port, sample size, name, container and prefix, each named", () => {
    const parsed = parseStoreRehearseArgs({
      rest: ["--port", "80", "--sample-size", "0", "--into", "Bad-Name", "--container", "_x", "--from", "gs://b/p/"],
    });
    expect(unwrapErr(parsed).code).toBe("ARGUMENTS_REFUSED");
    const lines = storeCommandErrorLines({ error: unwrapErr(parsed) }).join("\n");
    expect(lines).toContain('--port takes a whole number from 1024 to 65535, not "80"');
    expect(lines).toContain('--sample-size takes a whole number from 1 to 1000, not "0"');
    expect(lines).toContain("Bad-Name");
    expect(lines).toContain('--container "_x" is not a name docker accepts');
    expect(lines).toContain('--from takes a <project>/<instant>/ prefix as the destination spells it, not "gs://b/p/"');
  });
});

describe("runStoreRehearse before anything runs", () => {
  it("prints usage for --help", async () => {
    expect(await runStoreRehearse(["node", "cli", "store", "rehearse", "--help"])).toBe(EXIT_OK);
  });

  it("exits usage on a flag the parser refuses, before reading a home or a destination", async () => {
    expect(await runStoreRehearse(["node", "cli", "store", "rehearse", "--port", "80"])).toBe(EXIT_USAGE);
  });
});

describe("the report, the record and the knowledge row", () => {
  it("leads with the verdict and carries each check's numbers", () => {
    const lines = rehearsalLines({ report: REPORT });
    expect(lines[0]).toBe("rehearsal PASSED");
    expect(lines).toContain("schema   identical — 1 catalog lines live, 1 copy");
    expect(lines).toContain("counts   1 tables · 2 rows in the copy, 3 live now · drifted 1");
    expect(lines).toContain("  drifted: public.a copy 2 live 3");
    expect(lines).toContain("sample   1 rows from 1 tables · equal 1 · 0 tables unsampled");
    expect(lines).toContain("storage  storage.tar 2 entries");
    expect(lines).toContain("files    3 named in files.json · 0 missing from the destination");
    expect(lines).toContain("vault    4/4 secrets restored and openable in the copy");
  });

  it("says when a backup carries no Vault leg, and when one did not restore", () => {
    const absent = rehearsalLines({ report: { ...REPORT, vault: { status: "absent" } } });
    const failed = rehearsalLines({ report: { ...REPORT, vault: { status: "failed", why: "wrong key" } } });
    expect([
      absent.includes("vault    NOT in this backup"),
      failed.includes("vault    did not restore: wrong key"),
    ]).toEqual([true, true]);
  });

  it("records a passed rehearsal for the monitor", () => {
    expect(passedOrFailedRecord({ report: REPORT })).toEqual({
      atIso: "2026-09-28T10:05:00.000Z",
      failures: [],
      prefix: "slopweaver/2026-09-27T18-32-20-978Z/",
      status: "passed",
    });
  });

  it("files a confirmed lesson naming the backup and the numbers", () => {
    const lesson = rehearsalLesson({ report: REPORT });
    expect(lesson.verdict).toBe("confirmed");
    expect(lesson.claim).toBe(
      "The newest store backup (slopweaver/2026-09-27T18-32-20-978Z/) restores into a throwaway Postgres and matches the live store",
    );
    expect(lesson.evidence).toContain("1/1 sampled rows byte-equal");
    expect(lesson.evidence).toContain("storage.tar 2 entries");
  });

  it("files a refuted lesson carrying each failure", () => {
    const failed: RehearsalReport = { ...REPORT, verdict: { failures: ["schema differs"], passed: false } };
    const lesson = rehearsalLesson({ report: failed });
    expect(lesson.verdict).toBe("refuted");
    expect(lesson.evidence).toContain("FAILED: schema differs");
  });
});

describe("the rehearsal record and the monitor over it", () => {
  const homes: string[] = [];
  afterEach(() => {
    homes.splice(0).forEach((made) => {
      rmSync(made, { force: true, recursive: true });
    });
  });

  /**
   * A throwaway home.
   *
   * @returns its path
   */
  function home(): string {
    const made = mkdtempSync(join(tmpdir(), "rehearsal-"));
    homes.push(made);
    return made;
  }

  it("is unmeasurable before any rehearsal has run", () => {
    expect(evaluateStoreRehearsal({ record: readRehearsalRecord({ home: home() }) }).state).toBe("unmeasurable");
  });

  it("is clear on a passed record", () => {
    const at = home();
    writeRehearsalRecord({ home: at, record: passedOrFailedRecord({ report: REPORT }) });
    expect(evaluateStoreRehearsal({ record: readRehearsalRecord({ home: at }) })).toEqual({
      monitorId: "store-rehearsal-failed",
      state: "clear",
    });
  });

  it("fires one subject on a failed record, naming the backup and the first reason", () => {
    const at = home();
    writeRehearsalRecord({
      home: at,
      record: {
        atIso: "2026-10-01T04:10:00.000Z",
        failures: ["schema differs", "x"],
        prefix: "slopweaver/p/",
        status: "failed",
      },
    });
    expect(evaluateStoreRehearsal({ record: readRehearsalRecord({ home: at }) })).toEqual({
      monitorId: "store-rehearsal-failed",
      state: "firing",
      subjects: [
        { id: "store-rehearsal", key: "failed", label: "slopweaver/p/ at 2026-10-01T04:10:00.000Z: schema differs" },
      ],
    });
  });

  it("is unmeasurable on a record this build cannot read", () => {
    const at = home();
    const path = rehearsalRecordPath({ home: at });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"status":"maybe"}');
    expect(evaluateStoreRehearsal({ record: readRehearsalRecord({ home: at }) }).state).toBe("unmeasurable");
  });
});

describe("the monthly rehearsal is a standing row", () => {
  it("runs `store rehearse` at 04:00 on the 1st and backfills a missed month", () => {
    expect(GENERIC_STANDING_ROWS.length).toBeGreaterThan(0);
    const row = GENERIC_STANDING_ROWS.find(
      (standing) => standing.definition.recipeId === "store-restore-rehearsal-monthly",
    )!;
    expect(row.definition.cadence).toBe("0 4 1 * *");
    expect(row.definition.onMissed).toBe("backfill");
    expect(row.definition.params).toEqual({ argv: ["store", "rehearse"] });
  });
});
