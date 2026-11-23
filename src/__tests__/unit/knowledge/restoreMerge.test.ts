/**
 * The restore planner's decisions — recovery into an empty database, and a checked merge into a live one.
 * Pure: the planner is handed both the export and the live rows, so no connection is needed.
 */
import { describe, expect, it } from "vitest";

import type { RecallRecord } from "../../../knowledge/recallRestore.js";
import type { RestoredRecording } from "../../../knowledge/restore.js";
import { type LiveRestoreState, planRestore, type RestoreInput } from "../../../knowledge/restoreMerge.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";

const LIVE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const IN_A = "bbbbbbbb-0000-4000-8000-000000000001";
const IN_B = "bbbbbbbb-0000-4000-8000-000000000002";
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

/** The same recording as the database hands it back. */
const stored = ({ row }: { row: RestoredRecording }): MemoryRecordingRow => ({ ...row, searchable: "" });

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

const EMPTY: LiveRestoreState = { memories: [], recalls: [] };

/** A live database holding one recording of another claim, at seq 10. */
const ONE_LIVE: LiveRestoreState = {
  memories: [stored({ row: recording({ id: "l-0000000000000255", recordingId: LIVE_ID, seq: 10 }) })],
  recalls: [],
};

/** An export of the given rows, ledger included. */
const input = ({
  memories,
  recalls = [],
}: {
  memories: readonly RestoredRecording[];
  recalls?: readonly RecallRecord[];
}): RestoreInput => ({ memories, recalls });

describe("planRestore — default (empty) mode", () => {
  it("writes every row verbatim, seq included, into an empty database", () => {
    const plan = unwrap(
      planRestore({
        incoming: input({ memories: [recording({ seq: 7 })], recalls: [recall({ seq: 3 })] }),
        live: EMPTY,
        mode: "empty",
      }),
    );
    expect(plan.memories.map((row) => [row.recordingId, row.seq])).toEqual([[IN_A, 7]]);
    expect(plan.recalls.map((row) => [row.recallId, row.seq])).toEqual([[RECALL_A, 3]]);
    expect(plan.skippedMemories).toBe(0);
  });

  it("refuses a database that already holds a recording", () => {
    const refusal = unwrapErr(
      planRestore({ incoming: input({ memories: [recording()] }), live: ONE_LIVE, mode: "empty" }),
    );
    expect(refusal.code).toBe("RESTORE_NOT_EMPTY");
    expect(refusal.message).toContain("pass --merge");
  });

  it("refuses a database whose only standing row is a recall", () => {
    const live: LiveRestoreState = { memories: [], recalls: [{ ...recall({ recallId: LIVE_ID }) }] };
    const refusal = unwrapErr(planRestore({ incoming: input({ memories: [recording()] }), live, mode: "empty" }));
    expect(refusal).toMatchObject({ code: "RESTORE_NOT_EMPTY", table: "memory_recalls" });
  });

  it("keeps a dangling supersedes — recovery reproduces the backup, it does not validate it", () => {
    const plan = unwrap(
      planRestore({
        incoming: input({ memories: [recording({ supersedes: "l-0000000000002748" })] }),
        live: EMPTY,
        mode: "empty",
      }),
    );
    expect(plan.memories.map((row) => row.supersedes)).toEqual(["l-0000000000002748"]);
  });
});

describe("planRestore — merge mode, exhaustive and boundary cases", () => {
  it("plans nothing for an empty export", () => {
    expect(unwrap(planRestore({ incoming: input({ memories: [] }), live: ONE_LIVE, mode: "merge" }))).toEqual({
      memories: [],
      recalls: [],
      skippedMemories: 0,
      skippedRecalls: 0,
    });
  });

  it("renumbers above the live maximum by value, not by array position", () => {
    const live: LiveRestoreState = {
      memories: [
        stored({ row: recording({ id: "l-0000000000000241", recordingId: LIVE_ID, seq: 40 }) }),
        stored({ row: recording({ id: "l-0000000000000242", recordingId: IN_B, seq: 3 }) }),
      ],
      recalls: [],
    };
    const plan = unwrap(planRestore({ incoming: input({ memories: [recording({ seq: 1 })] }), live, mode: "merge" }));
    expect(plan.memories.map((row) => row.seq)).toEqual([41]);
  });

  it("renumbers a large export consecutively, keeping every row", () => {
    const incoming = Array.from({ length: 837 }, (_, index) =>
      recording({
        id: `l-${index.toString(16).padStart(16, "0")}`,
        recordingId: `dddddddd-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
        seq: index + 1,
      }),
    );
    const plan = unwrap(planRestore({ incoming: input({ memories: incoming }), live: ONE_LIVE, mode: "merge" }));
    expect(plan.memories.length).toBe(837);
    expect([plan.memories[0]!.seq, plan.memories[836]!.seq]).toEqual([11, 847]);
    expect(new Set(plan.memories.map((row) => row.recordingId)).size).toBe(837);
  });

  /** One differing value per compared memory column — every column the planner must not ignore. */
  const MEMORY_MUTATIONS: readonly [string, Partial<RestoredRecording>][] = [
    ["behaviourChange", { behaviourChange: "changed" }],
    ["caveat", { caveat: "changed" }],
    ["claim", { claim: "changed" }],
    ["domain", { domain: "github" }],
    ["evidence", { evidence: "changed" }],
    ["id", { id: "l-0000000000000238" }],
    ["importKey", { importKey: "k:9" }],
    ["learner", { learner: "someone-else" }],
    ["repro", { repro: "slopweaver store probe x" }],
    ["retrievalCue", { retrievalCue: "changed" }],
    ["run", { run: "another-run" }],
    ["supersedes", { supersedes: "l-0000000000000002" }],
    ["surface", { surface: "cli" }],
    ["tier", { tier: 3 }],
    ["verdict", { verdict: "refuted" }],
    ["recordedAt", { recordedAt: new Date("2026-10-01T09:00:00.001Z") }],
    ["createdAt", { createdAt: new Date("2026-10-01T09:00:01.001Z") }],
  ];

  it("refuses a held recording that differs in any single compared column", () => {
    expect(MEMORY_MUTATIONS.length).toBeGreaterThan(0);
    const held = recording({ recordingId: LIVE_ID, seq: 10 });
    const live: LiveRestoreState = { memories: [stored({ row: held })], recalls: [] };
    const refusals = MEMORY_MUTATIONS.map(([column, change]) => ({
      column,
      refusal: unwrapErr(planRestore({ incoming: input({ memories: [{ ...held, ...change }] }), live, mode: "merge" })),
    }));
    expect(refusals).toEqual(
      MEMORY_MUTATIONS.map(([column]) => ({
        column,
        refusal: expect.objectContaining({ code: "RESTORE_CONFLICT", conflict: "recording-differs", rowId: LIVE_ID }),
      })),
    );
  });

  /** One differing value per compared recall column. */
  const RECALL_MUTATIONS: readonly [string, Partial<RecallRecord>][] = [
    ["evidence", { evidence: "changed" }],
    ["memoryId", { memoryId: "l-0000000000000002" }],
    ["outcome", { outcome: "broke" }],
    ["recordingId", { recordingId: IN_B }],
    ["run", { run: "another-run" }],
    ["recordedAt", { recordedAt: new Date("2026-10-01T09:00:00.001Z") }],
    ["createdAt", { createdAt: new Date("2026-10-01T09:00:01.001Z") }],
  ];

  it("refuses a held recall that differs in any single compared column", () => {
    expect(RECALL_MUTATIONS.length).toBeGreaterThan(0);
    const held = recall({ memoryId: "l-0000000000000255", recordingId: LIVE_ID, seq: 6 });
    const live: LiveRestoreState = { memories: ONE_LIVE.memories, recalls: [{ ...held }] };
    const refusals = RECALL_MUTATIONS.map(([column, change]) => ({
      column,
      refusal: unwrapErr(
        planRestore({ incoming: input({ memories: [], recalls: [{ ...held, ...change }] }), live, mode: "merge" }),
      ),
    }));
    expect(refusals).toEqual(
      RECALL_MUTATIONS.map(([column]) => ({
        column,
        refusal: expect.objectContaining({ code: "RESTORE_CONFLICT", conflict: "recall-differs", rowId: RECALL_A }),
      })),
    );
  });

  it("refuses an export holding two recordings with one non-null import key, and allows two nulls", () => {
    const refusal = unwrapErr(
      planRestore({
        incoming: input({
          memories: [
            recording({ importKey: "k:1", seq: 1 }),
            recording({ importKey: "k:1", recordingId: IN_B, seq: 2 }),
          ],
        }),
        live: EMPTY,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_DUPLICATE_KEY", key: "importKey", value: "k:1" });
    const plan = unwrap(
      planRestore({
        incoming: input({ memories: [recording({ seq: 1 }), recording({ recordingId: IN_B, seq: 2 })] }),
        live: EMPTY,
        mode: "merge",
      }),
    );
    expect(plan.memories.length).toBe(2);
  });

  it("refuses an export holding two recalls with one recallId, or with one seq", () => {
    const sameId = unwrapErr(
      planRestore({
        incoming: input({ memories: [recording()], recalls: [recall({ seq: 1 }), recall({ seq: 2 })] }),
        live: EMPTY,
        mode: "merge",
      }),
    );
    expect(sameId).toMatchObject({ code: "RESTORE_DUPLICATE_KEY", key: "recallId", table: "memory_recalls" });
    const sameSeq = unwrapErr(
      planRestore({
        incoming: input({
          memories: [recording()],
          recalls: [recall({ seq: 1 }), recall({ recallId: LIVE_ID, seq: 1 })],
        }),
        live: EMPTY,
        mode: "merge",
      }),
    );
    expect(sameSeq).toMatchObject({ code: "RESTORE_DUPLICATE_KEY", key: "seq", table: "memory_recalls", value: "1" });
  });

  it("accepts a supersedes naming a claim only the export itself brings", () => {
    const plan = unwrap(
      planRestore({
        incoming: input({
          memories: [
            recording({ seq: 1 }),
            recording({ id: "l-0000000000000002", recordingId: IN_B, seq: 2, supersedes: "l-0000000000000001" }),
          ],
        }),
        live: EMPTY,
        mode: "merge",
      }),
    );
    expect(plan.memories.map((row) => row.supersedes)).toEqual([null, "l-0000000000000001"]);
  });

  it("accepts a recall of a recording skipped as already held", () => {
    const held = recording({ recordingId: LIVE_ID, seq: 10 });
    const live: LiveRestoreState = { memories: [stored({ row: held })], recalls: [] };
    const plan = unwrap(
      planRestore({
        incoming: input({ memories: [held], recalls: [recall({ recordingId: LIVE_ID })] }),
        live,
        mode: "merge",
      }),
    );
    expect([plan.memories.length, plan.skippedMemories, plan.recalls.map((row) => row.seq)]).toEqual([0, 1, [1]]);
  });

  it("refuses a merge that would renumber recalls past the largest safe integer, where two would round to one", () => {
    const held = recording({ recordingId: LIVE_ID, seq: 10 });
    const top = { ...recall({ recallId: "dddddddd-0000-4000-8000-000000000001" }), seq: Number.MAX_SAFE_INTEGER };
    const live: LiveRestoreState = { memories: [stored({ row: held })], recalls: [top] };
    const error = unwrapErr(
      planRestore({
        incoming: input({
          memories: [],
          recalls: [
            recall({ recordingId: LIVE_ID, seq: 1 }),
            recall({ recallId: "cccccccc-0000-4000-8000-000000000002", recordingId: LIVE_ID, seq: 2 }),
          ],
        }),
        live,
        mode: "merge",
      }),
    );
    expect([error.code, error.message]).toEqual([
      "RESTORE_SEQ_EXHAUSTED",
      "the memory_recalls table's highest seq is 9007199254740991, and renumbering the export above it would pass " +
        "the largest integer a sequence value can be read back as — the merge was refused whole and nothing was written",
    ]);
  });

  it("renumbers right up to the largest safe integer and no further", () => {
    const top = stored({
      row: recording({ id: "l-0000000000000255", recordingId: LIVE_ID, seq: Number.MAX_SAFE_INTEGER - 1 }),
    });
    const plan = unwrap(
      planRestore({
        incoming: input({ memories: [recording()] }),
        live: { memories: [top], recalls: [] },
        mode: "merge",
      }),
    );
    expect(plan.memories.map((row) => row.seq)).toEqual([Number.MAX_SAFE_INTEGER]);
  });
});

describe("planRestore — merge mode", () => {
  it("renumbers inserted rows above the live maximum in the export's own seq order", () => {
    const plan = unwrap(
      planRestore({
        incoming: input({
          memories: [recording({ recordingId: IN_B, seq: 9 }), recording({ recordingId: IN_A, seq: 2 })],
        }),
        live: ONE_LIVE,
        mode: "merge",
      }),
    );
    expect(plan.memories.map((row) => [row.recordingId, row.seq])).toEqual([
      [IN_A, 11],
      [IN_B, 12],
    ]);
    expect(plan.memories.map((row) => row.recordedAt.toISOString())).toEqual([
      RECORDED_AT.toISOString(),
      RECORDED_AT.toISOString(),
    ]);
  });

  it("renumbers an incoming seq that collides with a live one", () => {
    const plan = unwrap(
      planRestore({ incoming: input({ memories: [recording({ seq: 10 })] }), live: ONE_LIVE, mode: "merge" }),
    );
    expect(plan.memories.map((row) => row.seq)).toEqual([11]);
  });

  it("skips a recording the database already holds identically, whatever its seq", () => {
    const held = recording({ recordingId: LIVE_ID, seq: 10 });
    const live: LiveRestoreState = { memories: [stored({ row: held })], recalls: [] };
    const plan = unwrap(
      planRestore({
        incoming: input({ memories: [{ ...held, seq: 4 }, recording({ recordingId: IN_B, seq: 5 })] }),
        live,
        mode: "merge",
      }),
    );
    expect(plan.memories.map((row) => [row.recordingId, row.seq])).toEqual([[IN_B, 11]]);
    expect(plan.skippedMemories).toBe(1);
  });

  it("refuses a held recording whose content differs", () => {
    const held = recording({ recordingId: LIVE_ID, seq: 10 });
    const live: LiveRestoreState = { memories: [stored({ row: held })], recalls: [] };
    const refusal = unwrapErr(
      planRestore({ incoming: input({ memories: [{ ...held, claim: "a different claim" }] }), live, mode: "merge" }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_CONFLICT", conflict: "recording-differs", rowId: LIVE_ID });
  });

  it("refuses an import key another stored recording already holds", () => {
    const live: LiveRestoreState = {
      memories: [stored({ row: recording({ importKey: "k:1", recordingId: LIVE_ID, seq: 10 }) })],
      recalls: [],
    };
    const refusal = unwrapErr(
      planRestore({ incoming: input({ memories: [recording({ importKey: "k:1" })] }), live, mode: "merge" }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_CONFLICT", conflict: "import-key-taken", rowId: IN_A });
  });

  it("refuses an export holding two rows with one recordingId, before looking at the database", () => {
    const refusal = unwrapErr(
      planRestore({
        incoming: input({ memories: [recording({ seq: 1 }), recording({ seq: 2 })] }),
        live: ONE_LIVE,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_DUPLICATE_KEY", key: "recordingId", value: IN_A });
  });

  it("refuses an export holding two rows with one seq", () => {
    const refusal = unwrapErr(
      planRestore({
        incoming: input({ memories: [recording({ seq: 3 }), recording({ recordingId: IN_B, seq: 3 })] }),
        live: EMPTY,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_DUPLICATE_KEY", key: "seq", table: "memories", value: "3" });
  });

  it("accepts a supersedes naming a live claim of the same kind", () => {
    const plan = unwrap(
      planRestore({
        incoming: input({ memories: [recording({ supersedes: "l-0000000000000255" })] }),
        live: ONE_LIVE,
        mode: "merge",
      }),
    );
    expect(plan.memories.map((row) => row.supersedes)).toEqual(["l-0000000000000255"]);
  });

  it("refuses a supersedes naming no claim in either the database or the export", () => {
    const refusal = unwrapErr(
      planRestore({
        incoming: input({ memories: [recording({ supersedes: "l-0000000000002748" })] }),
        live: ONE_LIVE,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_CLOSURE_BROKEN", link: "supersedes", rowId: IN_A });
  });

  it("refuses a supersedes naming a claim of another kind", () => {
    const live: LiveRestoreState = {
      memories: [
        stored({
          row: recording({
            id: "p-0000000000000255",
            kind: "preference",
            recordingId: LIVE_ID,
            seq: 10,
            surface: null,
            tier: null,
          }),
        }),
      ],
      recalls: [],
    };
    const refusal = unwrapErr(
      planRestore({
        incoming: input({ memories: [recording({ supersedes: "p-0000000000000255" })] }),
        live,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_CLOSURE_BROKEN", link: "supersedes" });
  });

  it("refuses a supersedes naming its own claim", () => {
    const refusal = unwrapErr(
      planRestore({
        incoming: input({ memories: [recording({ supersedes: "l-0000000000000001" })] }),
        live: EMPTY,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_CLOSURE_BROKEN", link: "supersedes", rowId: IN_A });
  });

  it("inserts a recall of an incoming recording, renumbered above the live recall maximum", () => {
    const live: LiveRestoreState = {
      memories: ONE_LIVE.memories,
      recalls: [{ ...recall({ memoryId: "l-0000000000000255", recallId: LIVE_ID, recordingId: LIVE_ID, seq: 6 }) }],
    };
    const plan = unwrap(
      planRestore({
        incoming: input({ memories: [recording()], recalls: [recall({ seq: 1 })] }),
        live,
        mode: "merge",
      }),
    );
    expect(plan.recalls.map((row) => [row.recallId, row.seq])).toEqual([[RECALL_A, 7]]);
  });

  it("refuses a recall naming a recording neither side holds", () => {
    const refusal = unwrapErr(
      planRestore({
        incoming: input({ memories: [recording()], recalls: [recall({ recordingId: IN_B })] }),
        live: EMPTY,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_CLOSURE_BROKEN", link: "recall-recording", rowId: RECALL_A });
  });

  it("refuses a recall whose recording belongs to another claim", () => {
    const refusal = unwrapErr(
      planRestore({
        incoming: input({ memories: [recording()], recalls: [recall({ recordingId: LIVE_ID })] }),
        live: ONE_LIVE,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_CLOSURE_BROKEN", link: "recall-claim", rowId: RECALL_A });
  });

  it("skips a recall held identically and refuses one that differs", () => {
    const held = recall({ memoryId: "l-0000000000000255", recordingId: LIVE_ID, seq: 6 });
    const live: LiveRestoreState = { memories: ONE_LIVE.memories, recalls: [{ ...held }] };
    const skipped = unwrap(
      planRestore({ incoming: input({ memories: [], recalls: [{ ...held, seq: 2 }] }), live, mode: "merge" }),
    );
    expect([skipped.recalls.length, skipped.skippedRecalls]).toEqual([0, 1]);
    const refusal = unwrapErr(
      planRestore({
        incoming: input({ memories: [], recalls: [{ ...held, evidence: "changed" }] }),
        live,
        mode: "merge",
      }),
    );
    expect(refusal).toMatchObject({ code: "RESTORE_CONFLICT", conflict: "recall-differs", rowId: RECALL_A });
  });
});
