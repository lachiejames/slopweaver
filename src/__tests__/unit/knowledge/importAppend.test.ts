/**
 * An applied import's knowledge append over a scripted client (`../../scriptedStoreClient.ts`): which statements it
 * issues in which order, and which refusal wins when an import carries more than one fault. What only a real
 * database proves — the append-only triggers, the sequences — is the opt-in
 * `src/__tests__/integration/storeImportWriters.test.ts`.
 */
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { appendImportedKnowledge } from "../../../knowledge/importAppend.js";
import { parseExportedRecall, type RecallRecord } from "../../../knowledge/recallRestore.js";
import { parseExportedLine, type RestoredRecording } from "../../../knowledge/restore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { memoriesTable } from "../../../store/schema/memories.js";
import { memoryRecallsTable } from "../../../store/schema/memoryRecalls.js";
import { type ScriptedStatement, scriptedStoreClient } from "../../scriptedStoreClient.js";
import { MEMORY_LINE, RECALL_LINE } from "../store/transfer/fixtures.js";

const MEMORY = unwrap(parseExportedLine({ line: MEMORY_LINE, lineNumber: 1 }));
const RECALL = unwrap(parseExportedRecall({ line: RECALL_LINE, lineNumber: 1 }));
const MEMORIES = `"${getTableName(memoriesTable)}"`;
const RECALLS = `"${getTableName(memoryRecallsTable)}"`;

/**
 * The first word of a statement and the table it names, so an order assertion reads as one string per statement.
 *
 * @param statement one statement the append issued
 * @returns e.g. `insert memories`, `select memories`
 */
function shape({ statement }: { statement: ScriptedStatement }): string {
  const verb = statement.query.split(" ")[0]!;
  const table = statement.query.includes(RECALLS) ? "recalls" : "memories";
  return `${verb} ${table}`;
}

/**
 * Run the append in a transaction over a register holding `held` recordings, each `[claim id, recording id]`.
 *
 * @param memories the imported recordings
 * @param recalls the imported recalls
 * @param held what the recall-reference read answers
 * @param thrown what every insert throws, when it should fail
 * @returns the append's outcome and the shape of every statement it issued
 */
async function append({
  memories,
  recalls,
  held = [],
  thrown,
}: {
  memories: readonly RestoredRecording[];
  recalls: readonly RecallRecord[];
  held?: readonly (readonly [string, string])[];
  thrown?: unknown;
}): Promise<{ outcome: Awaited<ReturnType<typeof appendImportedKnowledge>>; issued: readonly string[] }> {
  const { client, statements } = scriptedStoreClient({
    answer: ({ query }) => {
      if (query.startsWith("insert") && thrown !== undefined) {
        throw thrown;
      }
      if (query.startsWith("insert") && query.includes(RECALLS)) {
        return recalls.map((recall) => [recall.recallId]);
      }
      if (query.startsWith("insert") && query.includes(MEMORIES)) {
        return memories.map((memory) => [memory.recordingId]);
      }
      if (query.includes(" in (")) {
        return held;
      }
      return [];
    },
  });
  const outcome = await client.db.transaction(async (writer) => appendImportedKnowledge({ memories, recalls, writer }));
  return { issued: statements().map((statement) => shape({ statement })), outcome };
}

describe("appendImportedKnowledge", () => {
  it("inserts the memories, reads every recall's recording, then inserts the recalls", async () => {
    const { outcome, issued } = await append({
      held: [[MEMORY.id, MEMORY.recordingId]],
      memories: [MEMORY],
      recalls: [RECALL],
    });
    expect(unwrap(outcome)).toEqual({ memories: 1, recalls: 1 });
    expect(issued).toEqual(["insert memories", "select memories", "insert recalls"]);
  });

  it("issues no statement for an import carrying no memory and no recall", async () => {
    const { outcome, issued } = await append({ memories: [], recalls: [] });
    expect(unwrap(outcome)).toEqual({ memories: 0, recalls: 0 });
    expect(issued).toEqual([]);
  });

  it("refuses a self-retiring recording before it reads a single recall, so that refusal wins over a stray recall", async () => {
    const { outcome, issued } = await append({
      memories: [{ ...MEMORY, supersedes: MEMORY.id }],
      recalls: [{ ...RECALL, recordingId: "bbbbbbbb-0000-4000-8000-00000000dead" }],
    });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("SUPERSEDES_REFUSED");
    expect(refused.message).toBe(`cannot supersede ${MEMORY.id} — a recording never retires its own claim`);
    expect(issued).toEqual(["insert memories"]);
  });

  it("refuses the FIRST self-retiring recording in export order when two of them do", async () => {
    const second = { ...MEMORY, id: "l-0000000000000002", recordingId: "bbbbbbbb-0000-4000-8000-000000000002" };
    const { outcome } = await append({
      memories: [
        { ...MEMORY, supersedes: MEMORY.id },
        { ...second, supersedes: second.id },
      ],
      recalls: [],
    });
    expect(unwrapErr(outcome).message).toBe(`cannot supersede ${MEMORY.id} — a recording never retires its own claim`);
  });

  it("refuses a recording retiring a claim no recording carries, before any recall is read", async () => {
    const { outcome, issued } = await append({
      memories: [{ ...MEMORY, supersedes: "l-0000000000000099" }],
      recalls: [],
    });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("SUPERSEDES_REFUSED");
    expect(refused.message).toContain("no recording carries that claim id");
    expect(issued).toEqual(["insert memories", "select memories"]);
  });

  it("refuses a recall naming a recording nothing holds, inserting no recall", async () => {
    const stray = { ...RECALL, recordingId: "bbbbbbbb-0000-4000-8000-00000000dead" };
    const { outcome, issued } = await append({ memories: [MEMORY], recalls: [stray] });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("CORRUPT_RECORDING");
    expect(refused.message).toContain(
      `recall ${RECALL.recallId} counts claim ${RECALL.memoryId}, but no recording carries that id`,
    );
    expect(issued).toEqual(["insert memories", "select memories"]);
  });

  it("refuses a recall whose recording is of another claim", async () => {
    const { outcome } = await append({
      held: [["l-0000000000000002", RECALL.recordingId]],
      memories: [],
      recalls: [RECALL],
    });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("CORRUPT_RECORDING");
    expect(refused.message).toContain(
      `recall ${RECALL.recallId} counts claim ${RECALL.memoryId}, but that recording is of claim l-0000000000000002`,
    );
  });

  it("reads a driver failure as DATABASE_FAILED naming the step", async () => {
    const { outcome } = await append({ memories: [MEMORY], recalls: [], thrown: new Error("connection reset") });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("DATABASE_FAILED");
    expect(refused.message).toContain("could not append the imported memories and recalls");
  });
});
