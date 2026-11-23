/**
 * `knowledge restore`'s transaction on a REAL Postgres: the lock, the rollback, the sequences and the retry
 * that the unit file's fake cannot settle.
 *
 * OPT-IN, and never in CI: it needs a running local stack, and there is none in any lane. It is handed the
 * stack's ADMIN connection, creates its own throwaway database from it, migrates that, and drops it
 * afterwards — it never touches the database the admin URL names:
 *
 *   KNOWLEDGE_RESTORE_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/knowledgeRestoreStore.test.ts
 *
 * The cases run in order over one database, each reading what the one before it left.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { restoreKnowledge } from "../../knowledge/memoryRestoreStore.js";
import type { RecallRecord } from "../../knowledge/recallRestore.js";
import type { RestoredRecording } from "../../knowledge/restore.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { applyStore } from "../../store/migrate.js";
import { memoriesTable } from "../../store/schema/memories.js";
import { memoryRecallsTable } from "../../store/schema/memoryRecalls.js";

const ADMIN_URL = process.env["KNOWLEDGE_RESTORE_PROOF_ADMIN_URL"];

const RECORDED_AT = new Date("2026-10-01T09:00:00.000Z");
const CREATED_AT = new Date("2026-10-01T09:00:01.000Z");

/** One recording as the export decodes it, with a fresh physical id unless one is given. */
const recording = (over: Partial<RestoredRecording> = {}): RestoredRecording => ({
  behaviourChange: "check the sample rate first",
  caveat: null,
  claim: "acme's widget queue drains in order",
  createdAt: CREATED_AT,
  domain: "datadog",
  evidence: "0 of 412 traces over 7d",
  id: "l-0000000000000001",
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: RECORDED_AT,
  recordingId: randomUUID(),
  repro: null,
  retrievalCue: "a widget queue task",
  run: "ad-hoc",
  seq: 1,
  supersedes: null,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

/** One recall as the export decodes it. */
const recall = (over: Partial<RecallRecord> & { recordingId: string }): RecallRecord => ({
  createdAt: CREATED_AT,
  evidence: "re-ran the probe, still 0",
  memoryId: "l-0000000000000001",
  outcome: "held",
  recallId: randomUUID(),
  recordedAt: RECORDED_AT,
  run: "ad-hoc",
  seq: 1,
  ...over,
});

describe.skipIf(ADMIN_URL === undefined)("knowledge restore on a real Postgres (opt-in)", () => {
  const database = `knowledge_restore_proof_${randomUUID().slice(0, 8)}`;
  // Built in `beforeAll`, never at collection: `skipIf` still runs this body, and with no URL set a
  // collection-time `new URL(undefined)` throws before the skip can apply.
  let admin: postgres.Sql;
  let url: URL;
  let first: StoreClient;
  let second: StoreClient;
  /** The recordings and recall the first case restores, re-offered by the idempotence case. */
  const seeded = { memories: [recording({ seq: 100 }), recording({ id: "l-0000000000000002", seq: 101 })] };
  const seededRecall = recall({ recordingId: seeded.memories[0]!.recordingId, seq: 50 });

  beforeAll(async () => {
    admin = postgres(ADMIN_URL!, { max: 1, onnotice: () => {} });
    url = new URL(ADMIN_URL!);
    url.pathname = `/${database}`;
    await admin.unsafe(`create database ${database}`);
    unwrap(await applyStore({ url: url.toString() }));
    first = openStore({ url: url.toString() });
    second = openStore({ url: url.toString() });
  }, 120_000);

  afterAll(async () => {
    await first.close();
    await second.close();
    await admin.unsafe(`drop database if exists ${database} with (force)`);
    await admin.end();
  });

  it("keeps every seq verbatim into an empty database, and an ordinary write continues above them", async () => {
    const outcome = unwrap(
      await restoreKnowledge({ client: first, incoming: { ...seeded, recalls: [seededRecall] }, mode: "empty" }),
    );
    const { seq: _memorySeq, ...memory } = recording({ id: "l-0000000000000003" });
    const { seq: _recallSeq, ...ledger } = recall({ recordingId: memory.recordingId });
    const nextMemory = await first.db.insert(memoriesTable).values(memory).returning({ seq: memoriesTable.seq });
    const nextRecall = await first.db
      .insert(memoryRecallsTable)
      .values(ledger)
      .returning({ seq: memoryRecallsTable.seq });
    expect(outcome).toEqual({ insertedMemories: 2, insertedRecalls: 1, skippedMemories: 0, skippedRecalls: 0 });
    expect([nextMemory[0]!.seq, nextRecall[0]!.seq]).toEqual([102, 51]);
  });

  it("writes no row of a merge it refuses, the valid rows beside the clash included", async () => {
    const clash = recording({ claim: "a different claim", recordingId: seeded.memories[0]!.recordingId, seq: 1 });
    const fresh = recording({ id: "l-0000000000000004", seq: 2 });
    const result = await restoreKnowledge({
      client: first,
      incoming: { memories: [fresh, clash], recalls: [recall({ recordingId: fresh.recordingId, seq: 1 })] },
      mode: "merge",
    });
    const freshHeld = await first.db
      .select({ seq: memoriesTable.seq })
      .from(memoriesTable)
      .where(eq(memoriesTable.recordingId, fresh.recordingId));
    const recallsHeld = await first.db.select({ seq: memoryRecallsTable.seq }).from(memoryRecallsTable);
    expect(unwrapErr(result).code).toBe("RESTORE_CONFLICT");
    expect([freshHeld.length, recallsHeld.length]).toEqual([0, 2]);
  });

  it("writes nothing when the same export is merged again", async () => {
    const outcome = unwrap(
      await restoreKnowledge({ client: first, incoming: { ...seeded, recalls: [seededRecall] }, mode: "merge" }),
    );
    expect(outcome).toEqual({ insertedMemories: 0, insertedRecalls: 0, skippedMemories: 2, skippedRecalls: 1 });
  });

  it("backs off a writer holding memory_recalls mid-transaction, so both commit and no seq is shared", async () => {
    // The recall regrade's order: memory_recalls first, then memories. A restore that WAITED for its locks
    // here would hold memories while queued on memory_recalls, and Postgres would abort one of the two.
    let release = (): void => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = (): void => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const regraded = recording({ id: "l-0000000000000005" });
    const { seq: _regradeSeq, ...regradeRow } = regraded;
    const { seq: _regradeRecallSeq, ...regradeRecall } = recall({
      memoryId: regraded.id,
      recordingId: regraded.recordingId,
    });
    const writer = second.db.transaction(async (tx) => {
      await tx.insert(memoryRecallsTable).values(regradeRecall);
      holding();
      await released;
      await tx.insert(memoriesTable).values(regradeRow);
    });
    await held;
    const restored = recording({ id: "l-0000000000000006", seq: 1 });
    let pauses = 0;
    const outcome = unwrap(
      await restoreKnowledge({
        client: first,
        incoming: {
          memories: [restored],
          recalls: [recall({ memoryId: restored.id, recordingId: restored.recordingId, seq: 1 })],
        },
        mode: "merge",
        pause: async () => {
          pauses += 1;
          release();
          await writer;
        },
      }),
    );
    await writer;
    const memorySeqs = await first.db.select({ seq: memoriesTable.seq }).from(memoriesTable);
    const recallSeqs = await first.db.select({ seq: memoryRecallsTable.seq }).from(memoryRecallsTable);
    expect([outcome.insertedMemories, outcome.insertedRecalls, pauses]).toEqual([1, 1, 1]);
    expect([memorySeqs.length, new Set(memorySeqs.map((row) => row.seq)).size]).toEqual([5, 5]);
    expect([recallSeqs.length, new Set(recallSeqs.map((row) => row.seq)).size]).toEqual([4, 4]);
  });
});
