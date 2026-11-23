/*
 * The knowledge source of `talk recall`: a store page becomes a read whose count is the store's EXACT total, not the
 * claims it returned, and a claim's latest recording opens whole. `newestMemoriesMatching` is exercised through a
 * fake connection handed in as an argument — a seam, per `testing.md` — so what is under test is its mapping of the
 * driver's rows (a `bigint` count as a string, a timestamp as the driver produced it), never the SQL, which the live
 * proof on the owner's store settles (`slopweaver talk recall --words xero --source knowledge --json`).
 */
import { describe, expect, it } from "vitest";

import { KnowledgeErrors } from "../../../knowledge/errors.js";
import { newestMemoriesMatching } from "../../../knowledge/memoryNewest.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { StoreClient } from "../../../store/client.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";
import { knowledgeOpened, knowledgeRead } from "../../../talk/recallKnowledge.js";

/** A connection whose one `execute` answers the rows given, or throws the cause given. */
function fakeClient({ rows, cause }: { rows: readonly Record<string, unknown>[]; cause?: Error }): StoreClient {
  const db = {
    execute: async (): Promise<readonly Record<string, unknown>[]> => {
      if (cause !== undefined) {
        throw cause;
      }
      return rows;
    },
  };
  // The fake answers exactly the one call this reader makes; a structural cast hands it to the real type.
  return { close: async (): Promise<void> => {}, db } as unknown as StoreClient;
}

const ROW = {
  claim: "Xero does not run a scheduled sync",
  domain: "xero",
  id: "xero/sync-retired",
  recordedAt: "2026-10-08 07:37:55.355+00",
  total: "45",
  verdict: "confirmed",
};

describe("newestMemoriesMatching", () => {
  it("reads the exact total off the first row and each timestamp as an instant", async () => {
    const page = unwrap(
      await newestMemoriesMatching({ client: fakeClient({ rows: [ROW] }), limit: 30, query: "xero", sinceIso: null }),
    );
    expect(page).toEqual({
      memories: [
        {
          claim: "Xero does not run a scheduled sync",
          domain: "xero",
          id: "xero/sync-retired",
          recordedAtIso: "2026-10-08T07:37:55.355Z",
          verdict: "confirmed",
        },
      ],
      total: 45,
    });
  });

  it("answers a zero total when nothing matches", async () => {
    const page = unwrap(
      await newestMemoriesMatching({ client: fakeClient({ rows: [] }), limit: 30, query: "xero", sinceIso: null }),
    );
    expect(page).toEqual({ memories: [], total: 0 });
  });

  it("names a failed read rather than answering empty", async () => {
    const cause = new Error("connection refused");
    const failure = unwrapErr(
      await newestMemoriesMatching({
        client: fakeClient({ cause, rows: [] }),
        limit: 30,
        query: "xero",
        sinceIso: null,
      }),
    );
    expect(failure).toEqual(KnowledgeErrors.databaseFailed({ cause, doing: "read the newest matching claims" }));
  });
});

describe("knowledgeRead", () => {
  it("counts the store's total and points each claim at its id", () => {
    const read = knowledgeRead({
      page: {
        memories: [
          {
            claim: "Xero does not run a scheduled sync",
            domain: "xero",
            id: "xero/sync-retired",
            recordedAtIso: "2026-10-08T07:37:55.355Z",
            verdict: "confirmed",
          },
        ],
        total: 45,
      },
    });
    expect(read).toEqual({
      count: 45,
      incomplete: undefined,
      matches: [
        {
          about: "xero",
          atIso: "2026-10-08T07:37:55.355Z",
          pointer: "knowledge:xero%2Fsync-retired",
          source: "knowledge",
          text: "[confirmed] Xero does not run a scheduled sync",
          who: "fleet",
        },
      ],
      searched: true,
    });
  });
});

describe("knowledgeOpened", () => {
  it("opens the claim as the text and carries its other fields as detail", () => {
    const row: MemoryRecordingRow = {
      behaviourChange: "resync Xero on demand only",
      caveat: null,
      claim: "Xero does not run a scheduled sync",
      createdAt: new Date("2026-10-08T07:38:00.000Z"),
      domain: "xero",
      evidence: "the owner's ruling on the 8 Oct call",
      id: "xero/sync-retired",
      importKey: null,
      kind: "lesson",
      learner: "fleet",
      outcome: null,
      question: null,
      recordedAt: new Date("2026-10-08T07:37:55.355Z"),
      recordingId: "cccccccc-2222-3333-4444-555555555555",
      repro: null,
      retrievalCue: "a Xero sync question",
      run: "xero-resync-on-demand",
      searchable: "",
      seq: 1,
      supersedes: null,
      surface: "api",
      tier: 2,
      verdict: "confirmed",
    };
    const opened = knowledgeOpened({ row, text: "knowledge:xero%2Fsync-retired" });
    expect(opened.text).toBe("Xero does not run a scheduled sync");
    expect(opened.atIso).toBe("2026-10-08T07:37:55.355Z");
    expect(opened.detail).toEqual({
      behaviourChange: "resync Xero on demand only",
      caveat: null,
      domain: "xero",
      evidence: "the owner's ruling on the 8 Oct call",
      retrievalCue: "a Xero sync question",
      run: "xero-resync-on-demand",
      verdict: "confirmed",
    });
  });
});
