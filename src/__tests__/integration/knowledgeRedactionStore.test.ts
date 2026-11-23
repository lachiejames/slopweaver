/**
 * Knowledge redaction's in-place rewrite against a real store: the committed rules find a provider location the
 * test assembles at runtime, `--apply`'s transaction archives the old rows, rewrites prose, moves the claim id
 * into its recall and its superseder, and re-scans to zero — and no row is deleted.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store whose register is EMPTY, because a redaction
 * reads the whole table. Point it at a THROWAWAY database in the running stack — never `postgres`, which is the
 * live fleet's:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres knowledge_redaction_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/knowledge_redaction_proof slopweaver store push
 *   KNOWLEDGE_REDACTION_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/knowledge_redaction_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/knowledgeRedactionStore.test.ts
 *
 * Every row it writes is deleted afterwards.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recallsFileFor, writeRecalls, writeRows } from "../../cli/commands/knowledge/exportMemories.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "../../hygiene/forbiddenIdentifiers.js";
import { identifierScanner } from "../../hygiene/identifierScan.js";
import type { MemoryRecording } from "../../knowledge/memory.js";
import { restoreKnowledge } from "../../knowledge/memoryRestoreStore.js";
import { memoryId } from "../../knowledge/memoryRow.js";
import { readAllMemories, readAllRecalls } from "../../knowledge/memoryStore.js";
import { applyStoredKnowledgeRedaction, scanStoredKnowledge } from "../../knowledge/redactionStore.js";
import type { RestoredRecording } from "../../knowledge/restore.js";
import { unwrap } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { memoriesTable } from "../../store/schema/memories.js";
import { memoryRecallsTable } from "../../store/schema/memoryRecalls.js";

const PROOF_URL = process.env["KNOWLEDGE_REDACTION_PROOF_URL"];

/** The run every row this test writes carries. */
const PROOF_RUN = "redaction-proof";

const scanner = identifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES });

/** A workspace location no committed rule allows, assembled so this file never carries it. */
const location = ({ label }: { label: string }): string => `${label}.slack.com`;

/** One lesson recording, its claim id derived the way the real writer derives it. */
const lesson = ({
  claim,
  recordedAt,
  supersedes = null,
}: {
  claim: string;
  recordedAt: string;
  supersedes?: string | null;
}): MemoryRecording => ({
  behaviourChange: null,
  caveat: null,
  claim,
  domain: "slack",
  evidence: "measured twice",
  id: memoryId({ claim, domain: "slack", kind: "lesson" }),
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: new Date(recordedAt),
  recordingId: randomUUID(),
  repro: null,
  retrievalCue: null,
  run: PROOF_RUN,
  supersedes,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
});

describe.skipIf(PROOF_URL === undefined)("knowledge redaction in place (live store)", () => {
  const home = mkdtempSync(join(tmpdir(), "knowledge-redaction-proof-"));
  const archivePath = join(home, "pre-redaction.jsonl");
  const named = `paging on ${location({ label: "wobble" })} is by cursor`;
  let client: StoreClient;
  // The primary keys this test's committed restore wrote, so the cleanup deletes exactly those rows and never
  // one another connection inserted meanwhile.
  const writtenRecordings: string[] = [];
  const writtenRecalls: string[] = [];

  beforeAll(async () => {
    client = openStore({ url: PROOF_URL! });
    const held = await client.db.select().from(memoriesTable).limit(1);
    const recalled = await client.db.select().from(memoryRecallsTable).limit(1);
    if (held.length + recalled.length > 0) {
      throw new Error("KNOWLEDGE_REDACTION_PROOF_URL names a store that already holds knowledge rows");
    }
  });

  afterAll(async () => {
    if (writtenRecalls.length > 0) {
      await client.db.delete(memoryRecallsTable).where(inArray(memoryRecallsTable.recallId, writtenRecalls));
    }
    if (writtenRecordings.length > 0) {
      await client.db.delete(memoriesTable).where(inArray(memoriesTable.recordingId, writtenRecordings));
    }
    await client.close();
    rmSync(home, { force: true, recursive: true });
  });

  it("archives, rewrites, moves the claim id, re-scans to zero and deletes nothing", async () => {
    const first = lesson({ claim: named, recordedAt: "2026-10-01T00:00:00.000Z" });
    const second = lesson({ claim: named, recordedAt: "2026-10-02T00:00:00.000Z" });
    const later = lesson({ claim: "a later claim", recordedAt: "2026-10-03T00:00:00.000Z", supersedes: first.id });
    const restored = ({ row, seq }: { row: MemoryRecording; seq: number }): RestoredRecording => ({
      ...row,
      createdAt: row.recordedAt,
      seq,
    });
    const recallId = randomUUID();
    unwrap(
      await restoreKnowledge({
        client,
        incoming: {
          memories: [
            restored({ row: first, seq: 1 }),
            restored({ row: second, seq: 2 }),
            restored({ row: later, seq: 3 }),
          ],
          recalls: [
            {
              createdAt: new Date("2026-10-04T00:00:00.000Z"),
              evidence: `re-ran it against ${location({ label: "wobble" })}`,
              memoryId: first.id,
              outcome: "held",
              recallId,
              recordedAt: new Date("2026-10-04T00:00:00.000Z"),
              recordingId: second.recordingId,
              run: PROOF_RUN,
              seq: 1,
            },
          ],
        },
        mode: "empty",
      }),
    );
    // Recorded only once the one-transaction restore has committed, so a refused restore claims no row.
    writtenRecordings.push(first.recordingId, second.recordingId, later.recordingId);
    writtenRecalls.push(recallId);
    const before = unwrap(await scanStoredKnowledge({ client, scanner }));
    expect([
      before.rowsWithReferences,
      before.byField["memories.claim"],
      before.byField["memory_recalls.evidence"],
    ]).toEqual([3, 2, 1]);

    const outcome = unwrap(
      await applyStoredKnowledgeRedaction({
        archive: {
          path: archivePath,
          write: ({ memories, recalls }) => {
            writeRows({ out: archivePath, rows: memories });
            writeRecalls({ out: recallsFileFor({ out: archivePath }), rows: recalls });
          },
        },
        client,
        map: [],
        scanner,
      }),
    );

    const moved = memoryId({
      claim: `paging on ${location({ label: "example" })} is by cursor`,
      domain: "slack",
      kind: "lesson",
    });
    expect([outcome.changedMemories, outcome.changedRecalls, outcome.movedClaims, outcome.merges]).toEqual([
      3, 1, 1, 0,
    ]);
    expect(outcome.after.rowsWithReferences).toBe(0);
    const memories = unwrap(await readAllMemories({ client }));
    expect(memories.map((row) => [row.recordingId, row.id, row.supersedes])).toEqual([
      [first.recordingId, moved, null],
      [second.recordingId, moved, null],
      [later.recordingId, later.id, moved],
    ]);
    expect(memories[0]!.claim).toBe(`paging on ${location({ label: "example" })} is by cursor`);
    const recalls = unwrap(await readAllRecalls({ client }));
    expect(recalls.map((row) => [row.recallId, row.memoryId, row.evidence])).toEqual([
      [recallId, moved, `re-ran it against ${location({ label: "example" })}`],
    ]);
    const archived = readFileSync(archivePath, "utf8").trim().split("\n");
    expect(archived.length).toBe(3);
    expect(archived[0]).toContain(location({ label: "wobble" }));
    expect(readFileSync(recallsFileFor({ out: archivePath }), "utf8")).toContain(location({ label: "wobble" }));
    expect(unwrap(await scanStoredKnowledge({ client, scanner })).rowsWithReferences).toBe(0);
  });
});
