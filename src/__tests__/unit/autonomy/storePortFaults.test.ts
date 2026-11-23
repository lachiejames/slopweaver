/**
 * The store-backed autonomy port's failure paths: every row operation that refuses mid-write or mid-read surfaces
 * that refusal unchanged, never an empty answer and never a retry. The rows here are a plain seam whose every
 * operation answers what a case hands it — not a mock (`.claude/rules/testing.md`).
 */
import { describe, expect, it } from "vitest";

import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { buildAutonomyAction, buildAutonomySteer } from "../../../autonomy/row.js";
import { AutonomyStoreErrors } from "../../../autonomy/storeErrors.js";
import { type AutonomyRows, type StoredAutonomyRow, storeAutonomyLedgerPort } from "../../../autonomy/storePort.js";
import { productionAutonomyStoreSeams } from "../../../autonomy/storeRows.js";
import type { AutonomyActionRow, AutonomySteerRow } from "../../../autonomy/types.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

const HOME = "/fixture-home";

const ACT: AutonomyActionRow = unwrap(
  buildAutonomyAction({
    actionId: "16644-enqueue",
    bySession: "workspace:123 demo",
    doneIso: "2026-09-12T02:06:09Z",
    kind: "press-merge-when-ready",
    run: undefined,
    said: "Queued acme-admin #16644 to merge once its checks pass.",
    steer: undefined,
    subject: "https://github.com/acme/acme-admin/pull/16644",
    why: "CI green and mergeable",
    witness: "slopweaver github enqueue --pr 16644 -> queued",
  }),
);

const STEER: AutonomySteerRow = unwrap(
  buildAutonomySteer({
    actionId: "16644-enqueue",
    bySession: "supervisor",
    steer: "fine",
    steeredIso: "2026-09-12T03:00:00Z",
  }),
);

const OUTAGE = AutonomyStoreErrors.storeUnavailable({ doing: "answer", reason: "connection reset (a fixture fault)" });

/** Rows that hold the act, answer every operation successfully, and take any override a case hands them. */
function rowsWith(over: Partial<AutonomyRows> = {}): AutonomyRows {
  const held: StoredAutonomyRow = { importKey: "written:action:16644-enqueue", record: { ...ACT } };
  return {
    close: () => Promise.resolve(),
    imported: () => Promise.resolve(ok(true)),
    insert: () => Promise.resolve(ok(true)),
    readAction: () => Promise.resolve(ok(held)),
    readAll: () => Promise.resolve(ok([held])),
    ...over,
  };
}

/** The real port over rows a case shapes. */
function portOver({ rows }: { rows: AutonomyRows }): AutonomyLedgerPort {
  return storeAutonomyLedgerPort({
    seams: {
      connect: () => Promise.resolve(ok(rows)),
      source: () => ({ path: "/fixture-home/ledgers/autonomy.jsonl", presence: { kind: "absent" } }),
      steerNonce: () => "nonce-1",
    },
  });
}

describe("storeAutonomyLedgerPort — a refusal from the rows surfaces unchanged", () => {
  it("refuses a read when the import record cannot be read", async () => {
    const port = portOver({ rows: rowsWith({ imported: () => Promise.resolve(err(OUTAGE)) }) });
    expect(unwrapErr(await port.readRecords({ home: HOME }))).toEqual(OUTAGE);
  });

  it("refuses a read when the ledger rows cannot be read", async () => {
    const port = portOver({ rows: rowsWith({ readAll: () => Promise.resolve(err(OUTAGE)) }) });
    expect(unwrapErr(await port.readRecords({ home: HOME }))).toEqual(OUTAGE);
  });

  it("refuses an act whose insert failed", async () => {
    const port = portOver({ rows: rowsWith({ insert: () => Promise.resolve(err(OUTAGE)) }) });
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: ACT }))).toEqual(OUTAGE);
  });

  it("refuses a lost act insert when the winner cannot be read back", async () => {
    const port = portOver({
      rows: rowsWith({ insert: () => Promise.resolve(ok(false)), readAction: () => Promise.resolve(err(OUTAGE)) }),
    });
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: ACT }))).toEqual(OUTAGE);
  });

  it("reads a lost act insert with no act behind it as a taken key, never as written", async () => {
    const port = portOver({
      rows: rowsWith({ insert: () => Promise.resolve(ok(false)), readAction: () => Promise.resolve(ok(undefined)) }),
    });
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: ACT }))).toEqual(
      AutonomyStoreErrors.writeKeyTaken({ actionId: "16644-enqueue" }),
    );
  });

  it("refuses a lost act insert whose stored winner decodes as a steer", async () => {
    const port = portOver({
      rows: rowsWith({
        insert: () => Promise.resolve(ok(false)),
        readAction: () => Promise.resolve(ok({ importKey: "k-steer", record: { ...STEER } })),
      }),
    });
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: ACT }))).toEqual(
      AutonomyStoreErrors.rowUnreadable({ importKey: "k-steer", why: "an action row decodes as a steer" }),
    );
  });

  it("refuses a lost act insert whose stored winner is not a record at all", async () => {
    const port = portOver({
      rows: rowsWith({
        insert: () => Promise.resolve(ok(false)),
        readAction: () => Promise.resolve(ok({ importKey: "k-junk", record: { junk: true } })),
      }),
    });
    const refused = unwrapErr(await port.appendRecord({ home: HOME, record: ACT }));
    expect(refused.code).toBe("AUTONOMY_ROW_UNREADABLE");
    expect(refused.message).toContain("autonomy_event k-junk holds a record that is not an act");
  });

  it("refuses a steer when the act it names cannot be read", async () => {
    const port = portOver({ rows: rowsWith({ readAction: () => Promise.resolve(err(OUTAGE)) }) });
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: STEER }))).toEqual(OUTAGE);
  });

  it("refuses a steer whose insert failed", async () => {
    const port = portOver({ rows: rowsWith({ insert: () => Promise.resolve(err(OUTAGE)) }) });
    expect(unwrapErr(await port.appendRecord({ home: HOME, record: STEER }))).toEqual(OUTAGE);
  });

  it("turns a connect that rejects into the typed outage, naming the throw", async () => {
    const port = storeAutonomyLedgerPort({
      seams: {
        connect: () => Promise.reject(new Error("socket hang up")),
        source: () => ({ path: "/fixture-home/ledgers/autonomy.jsonl", presence: { kind: "absent" } }),
        steerNonce: () => "nonce-1",
      },
    });
    expect(unwrapErr(await port.readRecords({ home: HOME }))).toEqual(
      AutonomyStoreErrors.storeUnavailable({ doing: "be opened", reason: "socket hang up" }),
    );
  });

  it("names an unknown failure when a connect rejects with a non-Error", async () => {
    const port = storeAutonomyLedgerPort({
      seams: {
        // oxlint-disable-next-line prefer-promise-reject-errors -- the case under test IS a non-Error rejection
        connect: () => Promise.reject("not an error"),
        source: () => ({ path: "/fixture-home/ledgers/autonomy.jsonl", presence: { kind: "absent" } }),
        steerNonce: () => "nonce-1",
      },
    });
    expect(unwrapErr(await port.readRecords({ home: HOME }))).toEqual(
      AutonomyStoreErrors.storeUnavailable({ doing: "be opened", reason: "unknown failure" }),
    );
  });
});

describe("productionAutonomyStoreSeams", () => {
  it("places a home's register under its ledgers directory and reports it absent in an empty home", () => {
    const source = productionAutonomyStoreSeams().source({ home: "/no/such/fixture-home" });
    expect(source.path).toBe("/no/such/fixture-home/ledgers/autonomy.jsonl");
    expect(source.presence).toEqual({ kind: "absent" });
  });

  it("hands a different steer nonce each time, so the same word given twice is two rows", () => {
    const seams = productionAutonomyStoreSeams();
    expect(seams.steerNonce()).not.toBe(seams.steerNonce());
  });
});
