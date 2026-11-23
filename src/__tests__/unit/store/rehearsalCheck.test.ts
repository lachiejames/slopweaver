/**
 * The restore rehearsal's pure verdicts: schema, counts, the byte-equal sample, the other two legs, and the
 * whole rehearsal's pass or fail over them.
 */
import { describe, expect, it } from "vitest";

import {
  compareSchema,
  insertionColumn,
  judgeCount,
  judgeRehearsal,
  judgeSample,
  type LegsReading,
  recordsChangeTime,
  type SampleVerdict,
  type VaultReading,
} from "../../../store/backup/rehearsalCheck.js";

const VAULT_OK: VaultReading = { expected: 3, restored: 3, status: "restored" };

const LEGS_OK: LegsReading = { files: { missing: [], named: 12 }, storage: { entries: 4, status: "listed" } };
const SCHEMA_OK = compareSchema({
  copy: ["relation public.a", "column public.a.id"],
  live: ["relation public.a", "column public.a.id"],
});
const EQUAL_ROW: SampleVerdict = { key: "1", table: "public.a", verdict: "equal" };
const EQUAL_COUNT = judgeCount({ reading: { copy: 3, frontier: null, live: 3, table: "public.a" } });

describe("compareSchema", () => {
  it("calls two identical fingerprints identical", () => {
    expect(SCHEMA_OK).toEqual({ copyLines: 2, identical: true, liveLines: 2, onlyCopy: [], onlyLive: [] });
  });

  it("names every line only one side has", () => {
    expect(compareSchema({ copy: ["b", "c"], live: ["a", "b"] })).toEqual({
      copyLines: 2,
      identical: false,
      liveLines: 2,
      onlyCopy: ["c"],
      onlyLive: ["a"],
    });
  });

  it("refuses to call two empty fingerprints identical", () => {
    expect(compareSchema({ copy: [], live: [] }).identical).toBe(false);
  });

  it("calls the BETWEEN constraint identical across a dump and restore", () => {
    expect(
      compareSchema({
        copy: [
          "constraint public.k.k_shape CHECK (((length(s) >= 2) AND (length(s) <= 40) AND (s ~ '^[a-z]+$'::text)))",
        ],
        live: [
          "constraint public.k.k_shape CHECK ((((length(s) >= 2) AND (length(s) <= 40)) AND (s ~ '^[a-z]+$'::text)))",
        ],
      }),
    ).toEqual({ copyLines: 1, identical: true, liveLines: 1, onlyCopy: [], onlyLive: [] });
  });

  it("never regroups a line that carries raw text, such as an enum's labels", () => {
    expect(
      compareSchema({
        copy: ["type public.e enum=((a) AND (b) AND (c))"],
        live: ["type public.e enum=(((a) AND (b)) AND (c))"],
      }),
    ).toEqual({
      copyLines: 1,
      identical: false,
      liveLines: 1,
      onlyCopy: ["type public.e enum=((a) AND (b) AND (c))"],
      onlyLive: ["type public.e enum=(((a) AND (b)) AND (c))"],
    });
  });

  it("never regroups a column's type, which is printed as a quoted literal", () => {
    expect(
      compareSchema({
        copy: ["column public.t.c 'public.weird((a) AND (b) AND (c))' notnull=f default=<NULL>"],
        live: ["column public.t.c 'public.weird(((a) AND (b)) AND (c))' notnull=f default=<NULL>"],
      }),
    ).toEqual({
      copyLines: 1,
      identical: false,
      liveLines: 1,
      onlyCopy: ["column public.t.c 'public.weird((a) AND (b) AND (c))' notnull=f default=<NULL>"],
      onlyLive: ["column public.t.c 'public.weird(((a) AND (b)) AND (c))' notnull=f default=<NULL>"],
    });
  });

  it("still names a real difference, in its canonical form", () => {
    expect(
      compareSchema({
        copy: [
          "constraint public.k.k_shape CHECK (((length(s) >= 2) AND (length(s) <= 50) AND (s ~ '^[a-z]+$'::text)))",
        ],
        live: [
          "constraint public.k.k_shape CHECK ((((length(s) >= 2) AND (length(s) <= 40)) AND (s ~ '^[a-z]+$'::text)))",
        ],
      }),
    ).toEqual({
      copyLines: 1,
      identical: false,
      liveLines: 1,
      onlyCopy: [
        "constraint public.k.k_shape CHECK (((length(s) >= 2) AND (length(s) <= 50) AND (s ~ '^[a-z]+$'::text)))",
      ],
      onlyLive: [
        "constraint public.k.k_shape CHECK (((length(s) >= 2) AND (length(s) <= 40) AND (s ~ '^[a-z]+$'::text)))",
      ],
    });
  });
});

describe("insertionColumn", () => {
  it("picks the most specific insertion column the table has", () => {
    expect(insertionColumn({ columns: ["id", "recorded_at", "created_at"] })).toBe("created_at");
    expect(insertionColumn({ columns: ["id", "first_seen_at"] })).toBe("first_seen_at");
  });

  it("answers null for a table with none", () => {
    expect(insertionColumn({ columns: ["id", "updated_at"] })).toBe(null);
  });
});

describe("judgeCount", () => {
  it("is equal when both sides agree", () => {
    expect(EQUAL_COUNT.verdict).toBe("equal");
  });

  it("reconciles when live up to the copy's own frontier equals the copy", () => {
    const frontier = { column: "created_at", copyMax: "2026-09-27T18:30:00Z", liveUpTo: 90 };
    expect(judgeCount({ reading: { copy: 90, frontier, live: 120, table: "public.a" } }).verdict).toBe("reconciled");
  });

  it("drifts when the frontier does not explain the difference", () => {
    const frontier = { column: "created_at", copyMax: "2026-09-27T18:30:00Z", liveUpTo: 89 };
    expect(judgeCount({ reading: { copy: 90, frontier, live: 120, table: "public.a" } }).verdict).toBe("drifted");
    expect(judgeCount({ reading: { copy: 90, frontier: null, live: 120, table: "public.a" } }).verdict).toBe("drifted");
  });

  it("is missing when either side lacks the table", () => {
    expect(judgeCount({ reading: { copy: null, frontier: null, live: 4, table: "public.a" } }).verdict).toBe("missing");
    expect(judgeCount({ reading: { copy: 4, frontier: null, live: null, table: "public.a" } }).verdict).toBe("missing");
  });
});

describe("judgeSample", () => {
  const base = { copySha256: "aa", key: "7", table: "public.a", tableRecordsChanges: true };

  it("is equal when both digests match", () => {
    expect(judgeSample({ reading: { ...base, liveSha256: "aa", liveTouchedAfterDump: false } }).verdict).toBe("equal");
  });

  it("is changed-after-backup when live was touched since the dump", () => {
    expect(judgeSample({ reading: { ...base, liveSha256: "bb", liveTouchedAfterDump: true } }).verdict).toBe(
      "changed-after-backup",
    );
  });

  it("is different when it differs and the table's change-time column says it was not touched", () => {
    expect(judgeSample({ reading: { ...base, liveSha256: "bb", liveTouchedAfterDump: false } }).verdict).toBe(
      "different",
    );
  });

  it("is untracked-change when it differs in a table nothing records a rewrite in", () => {
    const reading = { ...base, liveSha256: "bb", liveTouchedAfterDump: false, tableRecordsChanges: false };
    expect(judgeSample({ reading }).verdict).toBe("untracked-change");
  });

  it("is missing-on-live when live no longer holds the key", () => {
    expect(judgeSample({ reading: { ...base, liveSha256: null, liveTouchedAfterDump: false } }).verdict).toBe(
      "missing-on-live",
    );
  });
});

describe("recordsChangeTime", () => {
  it("reads the change-time columns the live store actually carries", () => {
    expect(recordsChangeTime({ columns: ["created_at", "updated_at"] })).toBe(true);
    expect(recordsChangeTime({ columns: ["loaded_at"] })).toBe(true);
    expect(recordsChangeTime({ columns: ["last_seen_at"] })).toBe(true);
    expect(recordsChangeTime({ columns: ["file_modified_at"] })).toBe(true);
    expect(recordsChangeTime({ columns: ["last_edited_at"] })).toBe(true);
  });

  it("does not read an insertion or event time as one — public.content's own columns", () => {
    expect(recordsChangeTime({ columns: ["occurred_at", "created_at"] })).toBe(false);
    expect(recordsChangeTime({ columns: [] })).toBe(false);
  });
});

describe("judgeRehearsal", () => {
  const whole = { counts: [EQUAL_COUNT], legs: LEGS_OK, sample: [EQUAL_ROW], schema: SCHEMA_OK };

  it("passes a rehearsal whose every check holds", () => {
    expect(judgeRehearsal({ ...whole, vault: VAULT_OK })).toEqual({ failures: [], passed: true });
  });

  it.each([
    [
      { status: "absent" } as const,
      "the backup carries no Vault leg, so a restore from it would lose every Vault secret",
    ],
    [
      { status: "failed", why: "vault.enc was sealed under another key" } as const,
      "the Vault leg did not restore: vault.enc was sealed under another key",
    ],
    [
      { expected: 3, restored: 2, status: "restored" } as const,
      "the Vault leg recorded 3 secret(s) and the copy holds 2 it can open",
    ],
  ])("fails a Vault leg that is %j, naming why", (vault: VaultReading, line) => {
    expect(judgeRehearsal({ ...whole, vault })).toEqual({ failures: [line], passed: false });
  });

  it("does not fail on drift or on rows live changed since the dump", () => {
    const drifted = judgeCount({ reading: { copy: 1, frontier: null, live: 2, table: "public.b" } });
    const changed: SampleVerdict = { key: "2", table: "public.b", verdict: "changed-after-backup" };
    const untracked: SampleVerdict = { key: "3", table: "public.content", verdict: "untracked-change" };
    const verdict = judgeRehearsal({
      counts: [EQUAL_COUNT, drifted],
      legs: LEGS_OK,
      sample: [EQUAL_ROW, changed, untracked],
      schema: SCHEMA_OK,
      vault: VAULT_OK,
    });
    expect(verdict).toEqual({ failures: [], passed: true });
  });

  it("fails on every broken check, each named", () => {
    const missing = judgeCount({ reading: { copy: null, frontier: null, live: 2, table: "public.b" } });
    const different: SampleVerdict = { key: "9", table: "public.c", verdict: "different" };
    const verdict = judgeRehearsal({
      counts: [missing],
      legs: {
        files: { missing: ["slopweaver/blobs/ab/abcd"], named: 3 },
        storage: { status: "unreadable", why: "tar: bad header" },
      },
      sample: [different],
      schema: compareSchema({ copy: ["b"], live: ["a"] }),
      vault: { status: "absent" },
    });
    expect(verdict).toEqual({
      failures: [
        "schema differs: 1 catalog line(s) only on live, 1 only in the copy (live 1, copy 1)",
        "public.b: on live only",
        "public.c 9: differs from live, and live's change-time column says it was not touched since the dump",
        "the byte-equal sample matched no row at all",
        "storage.tar does not list as a tar: tar: bad header",
        "the destination lacks 1 object(s) files.json names, first slopweaver/blobs/ab/abcd",
        "the backup carries no Vault leg, so a restore from it would lose every Vault secret",
      ],
      passed: false,
    });
  });

  it("fails when nothing was counted or sampled", () => {
    expect(
      judgeRehearsal({ counts: [], legs: LEGS_OK, sample: [], schema: SCHEMA_OK, vault: VAULT_OK }).failures,
    ).toEqual(["the byte-equal sample matched no row at all", "the count comparison read no tables at all"]);
  });
});
