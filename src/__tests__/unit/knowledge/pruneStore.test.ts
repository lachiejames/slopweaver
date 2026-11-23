/**
 * The prune store's own decisions, exercised through an injected fake connection — the seam
 * `recallWriter.test.ts` uses, for the reason its header gives. What is under test is the ORDER of the
 * transaction (replacements written before anything is deleted, recalls before recordings), which deletes an
 * empty id list skips, and how a failure is typed. Which rows the SQL matches is settled against a real
 * Postgres, by the live run this verb shipped with, and nowhere here.
 */
import { describe, expect, it } from "vitest";

import type { MemoryRecording } from "../../../knowledge/memory.js";
import { applyPrune, readClaimsForArchive } from "../../../knowledge/pruneStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { StoreClient } from "../../../store/client.js";
import { memoriesTable } from "../../../store/schema/memories.js";

/** One write the fake transaction was asked to make, in order. */
interface Op {
  readonly verb: "insert" | "delete";
  readonly table: "memories" | "memory_recalls";
}

/**
 * A fake connection whose transaction logs each insert and delete, and answers `returning` with as many
 * rows as the test says that write touched.
 */
function fakeClient({
  ops,
  touched,
  fails = false,
}: {
  ops: Op[];
  touched: Record<string, number>;
  fails?: boolean;
}): StoreClient {
  const builder = ({ op }: { op: Op }): Record<string, unknown> => {
    const returning = async (): Promise<readonly unknown[]> =>
      Array.from({ length: touched[`${op.verb} ${op.table}`]! }, () => ({ id: "x" }));
    const chained = { returning, values: () => chained, where: () => chained };
    return chained;
  };
  const opFor = ({ verb, table }: { verb: Op["verb"]; table: unknown }): Record<string, unknown> => {
    const op: Op = { table: table === memoriesTable ? "memories" : "memory_recalls", verb };
    ops.push(op);
    return builder({ op });
  };
  const writer = {
    // named-object-params-exempt: Drizzle's `delete(table)` is positional, and the fake must match the call
    delete: (table: unknown): Record<string, unknown> => opFor({ table, verb: "delete" }),
    // named-object-params-exempt: Drizzle's `insert(table)` is positional, and the fake must match the call
    insert: (table: unknown): Record<string, unknown> => opFor({ table, verb: "insert" }),
  };
  const db = {
    // named-object-params-exempt: Drizzle's `transaction(callback)` is positional, and the fake must match
    transaction: async (run: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      if (fails) {
        throw new Error("connection reset");
      }
      return run(writer);
    },
  };
  // The fake answers exactly the calls the prune makes; a structural cast hands it to the real type.
  return { close: async (): Promise<void> => {}, db } as unknown as StoreClient;
}

/** A client whose every read throws, proving a call never reached it. */
const untouchable = { db: undefined } as unknown as StoreClient;

/** One replacement, only its count matters here. */
const REPLACEMENT = { id: "l-new" } as unknown as MemoryRecording;

describe("readClaimsForArchive", () => {
  it("answers an empty archive for no ids without touching the connection", async () => {
    const archived = unwrap(await readClaimsForArchive({ client: untouchable, ids: [] }));
    expect(archived).toEqual({ recalls: [], recordings: [] });
  });

  it("types a failed read as DATABASE_FAILED naming how many claims it was reading", async () => {
    const failure = unwrapErr(await readClaimsForArchive({ client: untouchable, ids: ["l-a", "l-b"] }));
    expect(failure.code).toBe("DATABASE_FAILED");
    expect(failure.message).toContain("read 2 claim(s) to archive");
  });
});

describe("applyPrune", () => {
  it("writes the replacements before it deletes, and deletes recalls before recordings", async () => {
    const ops: Op[] = [];
    const client = fakeClient({
      ops,
      touched: { "delete memories": 3, "delete memory_recalls": 1, "insert memories": 1 },
    });
    const written = unwrap(
      await applyPrune({ client, inserts: [REPLACEMENT], recallIds: ["r-1"], recordingIds: ["a", "b", "c"] }),
    );
    expect(ops).toEqual([
      { table: "memories", verb: "insert" },
      { table: "memory_recalls", verb: "delete" },
      { table: "memories", verb: "delete" },
    ]);
    expect(written).toEqual({ recallsRemoved: 1, recordingsRemoved: 3, recordingsWritten: 1 });
  });

  it("skips every write whose list is empty", async () => {
    const ops: Op[] = [];
    const client = fakeClient({ ops, touched: { "delete memories": 2 } });
    const written = unwrap(await applyPrune({ client, inserts: [], recallIds: [], recordingIds: ["a", "b"] }));
    expect(ops).toEqual([{ table: "memories", verb: "delete" }]);
    expect(written).toEqual({ recallsRemoved: 0, recordingsRemoved: 2, recordingsWritten: 0 });
  });

  it("types a failed transaction as DATABASE_FAILED naming the recordings it was pruning", async () => {
    const client = fakeClient({ fails: true, ops: [], touched: {} });
    const failure = unwrapErr(await applyPrune({ client, inserts: [], recallIds: [], recordingIds: ["a"] }));
    expect(failure.code).toBe("DATABASE_FAILED");
    expect(failure.message).toBe("could not prune 1 recording(s) — connection reset");
  });
});
