/**
 * The recall writer's own decisions, exercised through an injected fake connection.
 *
 * `.claude/rules/testing.md` bans a MOCK and allows a SEAM — "a plain fake function passed in, which is not
 * a mock". `recordRecall` takes its connection as a parameter, so this file hands it one: a chainable
 * thenable that answers the three calls the writer makes and records what it was asked to insert. What is
 * under test is the ORDER OF DECISIONS — read the latest recording, decide the regrade, write both rows in
 * one transaction — not the SQL, which only a real Postgres can settle and which the scratch-database run in
 * this pull request settles.
 */
import { describe, expect, it } from "vitest";

import { recordRecall } from "../../../knowledge/memoryRecordStore.js";
import type { RecallFields } from "../../../knowledge/recallAccounting.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { StoreClient } from "../../../store/client.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";

const RECALL_ID = "aaaaaaaa-2222-3333-4444-555555555555";
const REGRADE_ID = "bbbbbbbb-2222-3333-4444-555555555555";
const RECORDED_AT = new Date("2026-09-16T12:00:00.000Z");

/** The claim's latest recording, as the database would hand it back. */
const stored = (over: Partial<MemoryRecordingRow> = {}): MemoryRecordingRow => ({
  behaviourChange: "check the sample rate first",
  caveat: null,
  claim: "APM adaptive sampling sits upstream of retention filters",
  createdAt: new Date("2026-09-12T11:00:00.000Z"),
  domain: "datadog",
  evidence: "0 of 412 traces over 7d",
  id: "l-abc123",
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: new Date("2026-09-12T10:00:00.000Z"),
  recordingId: "cccccccc-2222-3333-4444-555555555555",
  repro: null,
  retrievalCue: "a datadog tracing task",
  run: "ad-hoc",
  searchable: "",
  seq: 5,
  supersedes: null,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

/** What one fake connection was asked to write. */
interface Written {
  readonly inserts: { table: string; values: Record<string, unknown> }[];
}

/**
 * A fake connection: every builder call returns the same chainable object, and awaiting it yields whatever
 * the current step was told to answer. It is a seam rather than a mock — no library is patched, nothing is
 * spied on, and the object is passed in as an ordinary argument.
 */
function fakeClient({ latest, written }: { latest: readonly MemoryRecordingRow[]; written: Written }): StoreClient {
  const insertedRows: Record<string, unknown>[] = [];
  // A Drizzle builder is awaited AND chained, so the seam is a real Promise carrying the builder methods —
  // rather than an object that defines `then` itself, which is the shape lint refuses and the one that
  // surprises an accidental `await`.
  const chain = ({ answer }: { answer: () => unknown }): Record<string, unknown> => {
    const methods: Record<string, unknown> = {};
    ["from", "where", "orderBy", "limit", "values", "returning", "set"].forEach((name) => {
      // named-object-params-exempt: a Drizzle builder method is positional, so the seam must accept that call
      methods[name] = (value: unknown): unknown => {
        if (name === "values" && typeof value === "object" && value !== null) {
          insertedRows.push(value as Record<string, unknown>);
        }
        return chain({ answer });
      };
    });
    return Object.assign(Promise.resolve(answer()), methods);
  };
  const writer = {
    execute: async (): Promise<void> => {},
    // named-object-params-exempt: Drizzle's `insert(table)` is positional, and the fake must match the call
    insert: (table: { [key: symbol]: unknown }): unknown => {
      written.inserts.push({ table: String(Object.getOwnPropertySymbols(table).length), values: {} });
      return chain({ answer: () => [{ ...insertedRows[insertedRows.length - 1], recallId: RECALL_ID }] });
    },
  };
  const db = {
    select: (): unknown => chain({ answer: () => latest }),
    // named-object-params-exempt: Drizzle's `transaction(callback)` is positional, and the fake must match
    transaction: (run: (tx: unknown) => Promise<unknown>): Promise<unknown> => run(writer),
  };
  // The fake answers exactly the calls these writers make; the full Drizzle surface is neither implemented
  // nor needed, and a structural cast is how a seam of this shape is handed to a function that takes the
  // real type.
  return { close: async (): Promise<void> => {}, db } as unknown as StoreClient;
}

/** A complete recall. */
const fields = (over: Partial<RecallFields> = {}): RecallFields => ({
  evidence: "re-ran the probe on 16 Sep",
  memoryId: "l-abc123",
  outcome: "held",
  run: "ad-hoc",
  ...over,
});

describe("recordRecall", () => {
  it("refuses a claim the register has never recorded, rather than counting a recall against nothing", async () => {
    const written: Written = { inserts: [] };
    const result = await recordRecall({
      client: fakeClient({ latest: [], written }),
      fields: fields(),
      recallId: RECALL_ID,
      recordedAt: RECORDED_AT,
      regradeRecordingId: REGRADE_ID,
    });
    expect(unwrapErr(result).code).toBe("MEMORY_UNKNOWN");
    expect(written.inserts.length).toBe(0);
  });

  it("writes the accounting row alone when a confirmed claim held", async () => {
    const written: Written = { inserts: [] };
    const result = await recordRecall({
      client: fakeClient({ latest: [stored()], written }),
      fields: fields(),
      recallId: RECALL_ID,
      recordedAt: RECORDED_AT,
      regradeRecordingId: REGRADE_ID,
    });
    expect(unwrap(result).regraded).toBe(null);
    expect(written.inserts.length).toBe(1);
  });

  it("writes the accounting row AND the regrade in one transaction when a memory broke", async () => {
    const written: Written = { inserts: [] };
    const result = await recordRecall({
      client: fakeClient({ latest: [stored()], written }),
      fields: fields({ outcome: "broke", verdict: "refuted" }),
      recallId: RECALL_ID,
      recordedAt: RECORDED_AT,
      regradeRecordingId: REGRADE_ID,
    });
    expect(unwrap(result).regraded).not.toBe(null);
    expect(written.inserts.length).toBe(2);
  });

  it("writes a confirming recording when a claim the register had refuted held again", async () => {
    const written: Written = { inserts: [] };
    const regraded = await recordRecall({
      client: fakeClient({ latest: [stored({ verdict: "refuted" })], written }),
      fields: fields(),
      recallId: RECALL_ID,
      recordedAt: RECORDED_AT,
      regradeRecordingId: REGRADE_ID,
    });
    expect(unwrap(regraded).regraded).not.toBe(null);
    expect(written.inserts.length).toBe(2);
  });
});
