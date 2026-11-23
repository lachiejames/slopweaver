import { describe, expect, it } from "vitest";

import { buildAutonomyClassSteer } from "../../../autonomy/classSteer.js";
import { buildAutonomyAction, buildAutonomySteer } from "../../../autonomy/row.js";
import { AutonomyStoreErrors } from "../../../autonomy/storeErrors.js";
import { autonomyEventRow } from "../../../autonomy/storeRecord.js";
import type { AutonomyActionRow, AutonomyRecord, AutonomySteerRow } from "../../../autonomy/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  heldAutonomyRecords,
  memoryAutonomyLedgerPort,
  memoryAutonomyStore,
  unavailableAutonomyLedgerPort,
} from "../../autonomyLedgerFixture.js";

const HOME = "/fixture-home";

/** One valid act, varying only what a test cares about. */
function act({
  actionId = "16644-enqueue",
  why = "CI green, mergeable, no code-owner request outstanding",
}: { actionId?: string; why?: string } = {}): AutonomyActionRow {
  return unwrap(
    buildAutonomyAction({
      actionId,
      bySession: "workspace:123 demo",
      doneIso: "2026-09-12T02:06:09.123456Z",
      kind: "press-merge-when-ready",
      run: undefined,
      said: "Queued acme-admin #16644 to merge once its checks pass.",
      steer: undefined,
      subject: "https://github.com/acme/acme-admin/pull/16644",
      why,
      witness: "slopweaver github enqueue --pr 16644 -> queued at position 1",
    }),
  );
}

/** One steer on an act. */
function steer({
  actionId = "16644-enqueue",
  word = "fine",
}: { actionId?: string; word?: string } = {}): AutonomySteerRow {
  return unwrap(
    buildAutonomySteer({ actionId, bySession: "supervisor", steer: word, steeredIso: "2026-09-12T03:00:00Z" }),
  );
}

describe("storeAutonomyLedgerPort — writes", () => {
  it("writes an act and steers and reads them back verbatim, in written order", async () => {
    const store = memoryAutonomyStore();
    const port = memoryAutonomyLedgerPort({ store });
    const classSteer = unwrap(
      buildAutonomyClassSteer({
        anchor: "transcript:aaaa#bbbb",
        bySession: "supervisor",
        classId: "rebases",
        kinds: "rebase-pr",
        steer: "always fine",
        steeredIso: "2026-09-12T04:00:00Z",
      }),
    );
    expect(unwrap(await port.appendRecord({ home: HOME, record: act() }))).toEqual({
      actionId: "16644-enqueue",
      appended: true,
    });
    unwrap(await port.appendRecord({ home: HOME, record: steer({ word: "fine" }) }));
    unwrap(await port.appendRecord({ home: HOME, record: steer({ word: "fine" }) }));
    unwrap(await port.appendRecord({ home: HOME, record: classSteer }));
    const expected: readonly AutonomyRecord[] = [act(), steer({ word: "fine" }), steer({ word: "fine" }), classSteer];
    expect(await heldAutonomyRecords({ port })).toEqual(expected);
    expect(store.rows.map((row) => row.importKey)).toEqual([
      "written:action:16644-enqueue",
      "written:steer:16644-enqueue:nonce-1",
      "written:steer:16644-enqueue:nonce-2",
      "written:steer:class.rebases:nonce-3",
    ]);
  });

  it("keeps the act's microsecond instant in the record, where occurred_at cannot", async () => {
    const store = memoryAutonomyStore();
    unwrap(await memoryAutonomyLedgerPort({ store }).appendRecord({ home: HOME, record: act() }));
    expect(store.rows[0]!.record).toEqual({ ...act() });
    expect(store.rows[0]!.occurredAt).toEqual(new Date("2026-09-12T02:06:09.123Z"));
  });

  it("answers appended:false for the same act twice, writing one row", async () => {
    const store = memoryAutonomyStore();
    const port = memoryAutonomyLedgerPort({ store });
    unwrap(await port.appendRecord({ home: HOME, record: act() }));
    expect(unwrap(await port.appendRecord({ home: HOME, record: act() }))).toEqual({
      actionId: "16644-enqueue",
      appended: false,
    });
    expect(store.rows.length).toBe(1);
  });

  it("refuses a different act under a held id, naming the field, with ONE insert attempt", async () => {
    const store = memoryAutonomyStore();
    const port = memoryAutonomyLedgerPort({ store });
    unwrap(await port.appendRecord({ home: HOME, record: act() }));
    const refused = unwrapErr(await port.appendRecord({ home: HOME, record: act({ why: "another reason entirely" }) }));
    expect(refused.code).toBe("ACTION_ID_CONFLICT");
    expect(store.inserts).toBe(2);
    expect(store.rows.length).toBe(1);
  });

  it("refuses a per-act steer naming no stored act, and writes nothing", async () => {
    const store = memoryAutonomyStore();
    const refused = unwrapErr(
      await memoryAutonomyLedgerPort({ store }).appendRecord({ home: HOME, record: steer({ actionId: "nope" }) }),
    );
    expect(refused.code).toBe("UNKNOWN_ACTION");
    expect(store.inserts).toBe(0);
  });

  it("refuses a lost steer key as AUTONOMY_WRITE_KEY_TAKEN rather than reading it as written", async () => {
    const store = memoryAutonomyStore();
    const port = memoryAutonomyLedgerPort({ store });
    unwrap(await port.appendRecord({ home: HOME, record: act() }));
    store.rows.push(unwrap(autonomyEventRow({ importKey: "written:steer:16644-enqueue:nonce-1", record: steer() })));
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: steer() }))).toEqual(
      AutonomyStoreErrors.writeKeyTaken({ actionId: "16644-enqueue" }),
    );
  });

  it("refuses an invalid record before opening the store", async () => {
    const store = memoryAutonomyStore();
    const refused = unwrapErr(
      await memoryAutonomyLedgerPort({ store }).appendRecord({ home: HOME, record: { ...act(), why: "" } }),
    );
    expect(refused.code).toBe("INVALID_FIELD");
    expect(store.opened).toBe(0);
  });

  it("refuses a NUL byte rather than storing a record nobody wrote", async () => {
    const refused = unwrapErr(autonomyEventRow({ importKey: "k", record: { ...act(), why: "a\u0000b" } }));
    expect(refused.code).toBe("AUTONOMY_RECORD_UNSTORABLE");
  });

  it("refuses a lone UTF-16 surrogate, which Postgres's jsonb input rejects", () => {
    const record = { ...act(), why: "a\uD800b" };
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({ actionId: record.actionId, reason: "it holds a lone UTF-16 surrogate" }),
    );
  });

  it("refuses a NUL byte nested inside an array field, not only a top-level one", () => {
    const classSteer = unwrap(
      buildAutonomyClassSteer({
        anchor: "transcript:aaaa#bbbb",
        bySession: "supervisor",
        classId: "rebases",
        kinds: "rebase-pr",
        steer: "always fine",
        steeredIso: "2026-09-12T04:00:00Z",
      }),
    );
    const record = { ...classSteer, kinds: ["rebase-pr", "a\u0000b"] } as unknown as AutonomyRecord;
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({ actionId: record.actionId, reason: "it holds a NUL byte" }),
    );
  });

  it("refuses year zero, a finite instant to JavaScript that Postgres has no year for", () => {
    const record = { ...act(), doneIso: "0000-01-01T00:00:00Z" };
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: record.actionId,
        reason: "0000-01-01T00:00:00Z is before year 1, which Postgres cannot hold",
      }),
    );
  });

  it("refuses a day its month does not have, which JavaScript would roll into the next month", () => {
    const record = { ...act(), doneIso: "2023-02-29T00:00:00Z" };
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: record.actionId,
        reason: "2023-02-29T00:00:00Z is not an instant",
      }),
    );
  });

  it("stores the 29th of February in a leap year, and of a century divisible by 400", () => {
    const at = ({ doneIso }: { doneIso: string }) =>
      unwrap(autonomyEventRow({ importKey: "k", record: { ...act(), doneIso } })).occurredAt.toISOString();
    expect([at({ doneIso: "2024-02-29T00:00:00Z" }), at({ doneIso: "2000-02-29T00:00:00Z" })]).toEqual([
      "2024-02-29T00:00:00.000Z",
      "2000-02-29T00:00:00.000Z",
    ]);
  });

  it("refuses the 29th of February in a century year not divisible by 400", () => {
    const record = { ...act(), doneIso: "1900-02-29T00:00:00Z" };
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record })).code).toBe("AUTONOMY_RECORD_UNSTORABLE");
  });

  it("refuses a four-digit local instant whose offset carries it past year 9999 in UTC", () => {
    const record = { ...act(), doneIso: "9999-12-31T23:59:59-14:00" };
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: record.actionId,
        reason: "9999-12-31T23:59:59-14:00 falls after year 9999 in UTC, which the store cannot bind",
      }),
    );
  });

  it("stores the last second of year 9999 in UTC", () => {
    const row = unwrap(autonomyEventRow({ importKey: "k", record: { ...act(), doneIso: "9999-12-31T23:59:59Z" } }));
    expect(row.occurredAt.toISOString()).toBe("9999-12-31T23:59:59.000Z");
  });

  it("stores year 1, the earliest instant Postgres can hold here", () => {
    const row = unwrap(autonomyEventRow({ importKey: "k", record: { ...act(), doneIso: "0001-01-01T00:00:00Z" } }));
    expect(row.occurredAt.toISOString()).toBe("0001-01-01T00:00:00.000Z");
  });

  it("refuses a NUL byte in a field the record holds non-enumerably, since the row still binds it", () => {
    const record = act();
    Object.defineProperty(record, "why", { enumerable: false, value: "a\u0000b" });
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({ actionId: record.actionId, reason: "it holds a NUL byte" }),
    );
  });

  it("refuses a NUL byte in a field NAME, which is serialised into the jsonb as surely as a value", () => {
    const record = { ...act(), ["bad\u0000key"]: "value" } as AutonomyRecord;
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({ actionId: record.actionId, reason: "it holds a NUL byte" }),
    );
  });

  it("refuses a BigInt field as unstorable, rather than letting the insert throw and read as an outage", () => {
    const record = { ...act(), extra: 1n } as AutonomyRecord;
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: record.actionId,
        reason: "it holds a bigint value, which JSON cannot hold",
      }),
    );
  });

  it("refuses a non-finite number, which JSON would rewrite as null", () => {
    const record = { ...act(), extra: [1, Number.POSITIVE_INFINITY] } as AutonomyRecord;
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: record.actionId,
        reason: "it holds the number Infinity, which JSON cannot hold",
      }),
    );
  });

  it("refuses a nested undefined, which JSON would drop", () => {
    const record = { ...act(), extra: { gone: undefined } } as AutonomyRecord;
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: record.actionId,
        reason: 'it holds an undefined value at "gone", which JSON would drop',
      }),
    );
  });

  it("refuses an array with a hole, which JSON would store as null", () => {
    const holed: number[] = [];
    holed[0] = 1;
    holed[2] = 3;
    const record = { ...act(), extra: holed } as AutonomyRecord;
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: record.actionId,
        reason: "it holds an array with a hole, which JSON would store as null",
      }),
    );
  });

  it("refuses a class instance, which JSON cannot hold verbatim", () => {
    const record = { ...act(), extra: new Map([["a", 1]]) } as AutonomyRecord;
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: record.actionId,
        reason: "it holds an object that is not a plain record, which JSON cannot hold verbatim",
      }),
    );
  });

  it("stores plain nested JSON — numbers, booleans, null and records — unchanged", () => {
    const record = { ...act(), extra: { count: 2, flag: false, none: null, list: ["a"] } } as AutonomyRecord;
    expect(unwrap(autonomyEventRow({ importKey: "k", record })).record).toEqual({
      ...act(),
      extra: { count: 2, flag: false, list: ["a"], none: null },
    });
  });

  it("stores a paired surrogate, which is well formed", () => {
    expect(unwrap(autonomyEventRow({ importKey: "k", record: { ...act(), why: "merged 🎉" } })).why).toBe("merged 🎉");
  });
});

describe("storeAutonomyLedgerPort — the import gate", () => {
  it("refuses every read and write while the register file is present and unimported", async () => {
    const store = memoryAutonomyStore();
    store.source = { kind: "present" };
    const port = memoryAutonomyLedgerPort({ store });
    const expected = AutonomyStoreErrors.notImported({ sourcePath: "/fixture-home/ledgers/autonomy.jsonl" });
    expect(unwrapErr(await port.readRecords({ home: HOME }))).toEqual(expected);
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: act() }))).toEqual(expected);
    expect(store.inserts).toBe(0);
    expect(store.closed).toBe(store.opened);
  });

  it("refuses when the file's presence cannot be told, naming why", async () => {
    const store = memoryAutonomyStore();
    store.source = { kind: "unknown", reason: "EACCES" };
    const refused = unwrapErr(await memoryAutonomyLedgerPort({ store }).readRecords({ home: HOME }));
    expect(refused).toEqual(
      AutonomyStoreErrors.importStateUnavailable({
        reason: "EACCES",
        sourcePath: "/fixture-home/ledgers/autonomy.jsonl",
      }),
    );
  });

  it("answers once imported, whatever the file now is", async () => {
    const store = memoryAutonomyStore();
    store.source = { kind: "present" };
    store.imported = true;
    expect(unwrap(await memoryAutonomyLedgerPort({ store }).readRecords({ home: HOME }))).toEqual([]);
  });
});

describe("storeAutonomyLedgerPort — refusals", () => {
  it("refuses an outage on every operation, never an empty ledger", async () => {
    const port = unavailableAutonomyLedgerPort();
    expect(unwrapErr(await port.readRecords({ home: HOME }))).toEqual(AUTONOMY_FIXTURE_OUTAGE);
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: act() }))).toEqual(AUTONOMY_FIXTURE_OUTAGE);
  });

  it("refuses the whole read on one stored row that is not a record, naming its key", async () => {
    const store = memoryAutonomyStore();
    const port = memoryAutonomyLedgerPort({ store });
    unwrap(await port.appendRecord({ home: HOME, record: act() }));
    const bad = unwrap(autonomyEventRow({ importKey: "imported:bad", record: act({ actionId: "other-act" }) }));
    store.rows.push({ ...bad, record: { actionId: "other-act" } });
    const refused = unwrapErr(await port.readRecords({ home: HOME }));
    expect(refused.code).toBe("AUTONOMY_ROW_UNREADABLE");
    expect(refused.message).toContain("imported:bad");
  });

  it("ignores a mirror row with no record, the shape earlier imports left", async () => {
    const store = memoryAutonomyStore();
    const port = memoryAutonomyLedgerPort({ store });
    const mirror = unwrap(autonomyEventRow({ importKey: "old-mirror", record: act() }));
    store.rows.push({ ...mirror, record: null });
    expect(unwrap(await port.appendRecord({ home: HOME, record: act() }))).toEqual({
      actionId: "16644-enqueue",
      appended: true,
    });
    expect(await heldAutonomyRecords({ port })).toEqual([act()]);
  });
});
