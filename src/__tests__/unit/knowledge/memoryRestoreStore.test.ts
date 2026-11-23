/**
 * The restore transaction's own decisions, exercised through an injected fake connection.
 *
 * Same seam as `recallWriter.test.ts`: `restoreKnowledge` takes its connection as a parameter, so this file
 * hands it a plain fake that answers the live-row reads and records what it was asked to insert and execute.
 * What is under test is the ORDER OF DECISIONS — read both tables inside the transaction, plan against them,
 * write nothing on a refusal, insert the plan's rows, re-sync both sequences on every commit, and ask again
 * for a held lock — not the SQL, which `integration/knowledgeRestoreStore.test.ts` settles on a real Postgres.
 */
import { describe, expect, it } from "vitest";

import { restoreKnowledge } from "../../../knowledge/memoryRestoreStore.js";
import type { RecallRecord } from "../../../knowledge/recallRestore.js";
import type { RestoredRecording } from "../../../knowledge/restore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { StoreClient } from "../../../store/client.js";
import { type MemoryRecordingRow, memoriesTable } from "../../../store/schema/memories.js";
import { type MemoryRecallRow, memoryRecallsTable } from "../../../store/schema/memoryRecalls.js";

const LIVE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const IN_A = "bbbbbbbb-0000-4000-8000-000000000001";
const RECALL_A = "cccccccc-0000-4000-8000-000000000001";
const RECORDED_AT = new Date("2026-10-01T09:00:00.000Z");
const CREATED_AT = new Date("2026-10-01T09:00:01.000Z");

/** One recording as the export decodes it. */
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
  recordingId: IN_A,
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
const recall = (over: Partial<RecallRecord> = {}): RecallRecord => ({
  createdAt: CREATED_AT,
  evidence: "re-ran the probe, still 0",
  memoryId: "l-0000000000000001",
  outcome: "held",
  recallId: RECALL_A,
  recordedAt: RECORDED_AT,
  recordingId: IN_A,
  run: "ad-hoc",
  seq: 1,
  ...over,
});

/** A live recording of another claim, at seq 10. */
const LIVE_ROW: MemoryRecordingRow = {
  ...recording({ id: "l-0000000000000255", recordingId: LIVE_ID, seq: 10 }),
  searchable: "",
};

/** What one fake connection was asked to do. */
interface Calls {
  readonly memoryInserts: Record<string, unknown>[];
  readonly recallInserts: Record<string, unknown>[];
  /** Every statement executed, counted — the table lock first, then one `setval` per table on a commit. */
  executes: number;
}

/**
 * A fake connection whose transaction answers the two live-row reads and records every insert and execute.
 * A seam rather than a mock — nothing is patched or spied on, and the object is passed in as an argument.
 */
function fakeClient({
  calls,
  liveMemories,
  liveRecalls,
  failInsert = false,
  lockBusyFor = 0,
}: {
  calls: Calls;
  liveMemories: readonly MemoryRecordingRow[];
  liveRecalls: readonly MemoryRecallRow[];
  failInsert?: boolean;
  /** How many transactions open to find the lock held: their lock statement throws what Drizzle throws. */
  lockBusyFor?: number;
}): StoreClient {
  let busyLeft = lockBusyFor;
  const writer = {
    execute: async (): Promise<void> => {
      calls.executes += 1;
    },
    // named-object-params-exempt: Drizzle's `insert(table)` is positional, and the fake must match the call
    insert: (table: unknown): unknown => ({
      // named-object-params-exempt: Drizzle's `values(rows)` is positional, and the fake must match the call
      values: (rows: readonly Record<string, unknown>[]): unknown => ({
        returning: async (): Promise<readonly unknown[]> => {
          if (failInsert) {
            throw new Error("connection reset");
          }
          const sink = table === memoriesTable ? calls.memoryInserts : calls.recallInserts;
          sink.push(...rows);
          return rows.map((row) => ({ id: row["recordingId"] }));
        },
      }),
    }),
    select: (): unknown => ({
      // named-object-params-exempt: Drizzle's `from(table)` is positional, and the fake must match the call
      from: async (table: unknown): Promise<readonly unknown[]> => {
        if (table === memoryRecallsTable) {
          return liveRecalls;
        }
        return liveMemories;
      },
    }),
  };
  const busyWriter = {
    ...writer,
    execute: async (): Promise<void> => {
      calls.executes += 1;
      throw new Error("Failed query: lock table", { cause: { code: "55P03", message: "could not obtain lock" } });
    },
  };
  const db = {
    // named-object-params-exempt: Drizzle's `transaction(callback)` is positional, and the fake must match
    transaction: (run: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      const busy = busyLeft > 0;
      busyLeft -= 1;
      return run(busy ? busyWriter : writer);
    },
  };
  // The fake answers exactly the calls the restore makes; a structural cast is how a seam of this shape is
  // handed to a function that takes the real type.
  return { close: async (): Promise<void> => {}, db } as unknown as StoreClient;
}

/** A fresh call record. */
const freshCalls = (): Calls => ({ executes: 0, memoryInserts: [], recallInserts: [] });

describe("restoreKnowledge", () => {
  it("refuses a default restore over a live table and writes nothing", async () => {
    const calls = freshCalls();
    const result = await restoreKnowledge({
      client: fakeClient({ calls, liveMemories: [LIVE_ROW], liveRecalls: [] }),
      incoming: { memories: [recording()], recalls: [] },
      mode: "empty",
    });
    expect(unwrapErr(result).code).toBe("RESTORE_NOT_EMPTY");
    expect([calls.memoryInserts.length, calls.recallInserts.length, calls.executes]).toEqual([0, 0, 1]);
  });

  it("merges into a live table, renumbering above its seq and advancing both sequences", async () => {
    const calls = freshCalls();
    const outcome = unwrap(
      await restoreKnowledge({
        client: fakeClient({ calls, liveMemories: [LIVE_ROW], liveRecalls: [] }),
        incoming: { memories: [recording({ seq: 3 })], recalls: [recall({ seq: 4 })] },
        mode: "merge",
      }),
    );
    expect(outcome).toEqual({ insertedMemories: 1, insertedRecalls: 1, skippedMemories: 0, skippedRecalls: 0 });
    expect(calls.memoryInserts.map((row) => [row["recordingId"], row["seq"]])).toEqual([[IN_A, 11]]);
    expect(calls.recallInserts.map((row) => [row["recallId"], row["seq"]])).toEqual([[RECALL_A, 1]]);
    expect(calls.executes).toBe(3);
  });

  it("skips an identical live row and still re-syncs both sequences when nothing is inserted", async () => {
    const calls = freshCalls();
    const outcome = unwrap(
      await restoreKnowledge({
        client: fakeClient({ calls, liveMemories: [LIVE_ROW], liveRecalls: [] }),
        incoming: { memories: [recording({ id: LIVE_ROW.id, recordingId: LIVE_ID, seq: 1 })], recalls: [] },
        mode: "merge",
      }),
    );
    expect(outcome).toEqual({ insertedMemories: 0, insertedRecalls: 0, skippedMemories: 1, skippedRecalls: 0 });
    expect(calls.executes).toBe(3);
  });

  it("re-syncs the recall sequence when every incoming recall is skipped but a recording is inserted", async () => {
    const calls = freshCalls();
    const liveRecall: MemoryRecallRow = { ...recall({ memoryId: LIVE_ROW.id, recordingId: LIVE_ID, seq: 10 }) };
    const outcome = unwrap(
      await restoreKnowledge({
        client: fakeClient({ calls, liveMemories: [LIVE_ROW], liveRecalls: [liveRecall] }),
        incoming: {
          memories: [recording({ id: LIVE_ROW.id, recordingId: LIVE_ID, seq: 1 }), recording({ seq: 2 })],
          recalls: [{ ...liveRecall, seq: 1 }],
        },
        mode: "merge",
      }),
    );
    expect(outcome).toEqual({ insertedMemories: 1, insertedRecalls: 0, skippedMemories: 1, skippedRecalls: 1 });
    expect(calls.executes).toBe(3);
  });

  it("turns a failed insert into a database failure rather than a throw, and never retries it", async () => {
    const calls = freshCalls();
    const pauses: number[] = [];
    const result = await restoreKnowledge({
      client: fakeClient({ calls, failInsert: true, liveMemories: [], liveRecalls: [] }),
      incoming: { memories: [recording()], recalls: [] },
      mode: "empty",
      pause: async ({ ms }) => {
        pauses.push(ms);
      },
    });
    expect(unwrapErr(result).code).toBe("DATABASE_FAILED");
    expect(pauses).toEqual([]);
  });

  it("asks again after a held lock, pausing between asks, and restores once the lock is free", async () => {
    const calls = freshCalls();
    const pauses: number[] = [];
    const outcome = unwrap(
      await restoreKnowledge({
        client: fakeClient({ calls, liveMemories: [], liveRecalls: [], lockBusyFor: 2 }),
        incoming: { memories: [recording()], recalls: [] },
        mode: "empty",
        pause: async ({ ms }) => {
          pauses.push(ms);
        },
      }),
    );
    expect(outcome).toEqual({ insertedMemories: 1, insertedRecalls: 0, skippedMemories: 0, skippedRecalls: 0 });
    expect(pauses).toEqual([250, 250]);
    expect([calls.memoryInserts.length, calls.executes]).toEqual([1, 5]);
  });

  it("refuses with RESTORE_LOCK_BUSY after every ask finds the lock held, having written nothing", async () => {
    const calls = freshCalls();
    const pauses: number[] = [];
    const result = await restoreKnowledge({
      client: fakeClient({ calls, liveMemories: [], liveRecalls: [], lockBusyFor: 20 }),
      incoming: { memories: [recording()], recalls: [] },
      mode: "empty",
      pause: async ({ ms }) => {
        pauses.push(ms);
      },
    });
    const refusal = unwrapErr(result);
    expect([refusal.code, pauses.length, calls.executes, calls.memoryInserts.length]).toEqual([
      "RESTORE_LOCK_BUSY",
      19,
      20,
      0,
    ]);
    expect(refusal.message).toContain("all 20 asks");
  });
});
