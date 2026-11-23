/**
 * Reading a staged batch back and deciding whether it applies: every staged row re-decoded and checked against what
 * was staged, the export planned again against the live store, and an apply allowed only on the staged plan with
 * every answer it needs — an append-only difference reported and never waited on, unless a strict apply stops on it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { StoreImportApplyErrors } from "../../../../store/transfer/importApplyErrors.js";
import { applicationReadiness, reconstructStagedImport } from "../../../../store/transfer/importApplyPlan.js";
import { MEMORY_LINE, OWNER } from "./fixtures.js";
import {
  ACTIVE,
  BATCH_ID,
  CHANGED_MEMORY_LINE,
  EMPTY_LIVE,
  liveOf,
  questionIds,
  replan,
  runCleanups,
  type StagedBatch,
  stagedBatch,
} from "./stagedBatch.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  runCleanups({ cleanups });
});

/** {@link stagedBatch}, its export directory removed after each test. */
function staged(over: Omit<Parameters<typeof stagedBatch>[0], "cleanups"> = {}): StagedBatch {
  return stagedBatch({ cleanups, ...over });
}

describe("reconstructStagedImport", () => {
  it("reads every part back to the entries it was staged from, so the export plans to the staged plan again", () => {
    const { draft, rows } = staged();
    const read = unwrap(reconstructStagedImport(rows));

    expect([...read.imported.keys()]).toEqual(draft.parts);
    expect([...read.imported.values()].map((entries) => entries.length)).toEqual([1, 1, 1, 1, 2, 1, 2]);
    expect(replan({ import: read, live: EMPTY_LIVE }).digest).toBe(draft.planDigest);
    expect(read.answers.size).toBe(0);
  });

  it("keeps each row's staged summary, which a question was asked in", () => {
    const { rows } = staged();
    const summaries = new Map(rows.items.map((item) => [`${item.part}/${item.key}`, item.summary]));
    const read = unwrap(reconstructStagedImport(rows));

    expect(
      [...read.imported.entries()].flatMap(([part, entries]) =>
        entries.filter((entry) => entry.summary !== summaries.get(`${part}/${entry.key}`)).map((entry) => entry.key),
      ),
    ).toEqual([]);
  });

  it("refuses a staged row whose payload decodes to another row than the one staged in its place", () => {
    const { rows } = staged();
    const items = rows.items.map((item) =>
      item.part === "memories" ? { ...item, payload: JSON.parse(CHANGED_MEMORY_LINE) } : item,
    );
    const memory = rows.items.find((item) => item.part === "memories")!;

    expect(unwrapErr(reconstructStagedImport({ ...rows, items }))).toMatchObject({
      code: "IMPORT_STAGED_PAYLOAD_INVALID",
      key: memory.key,
      part: "memories",
    });
  });

  it("refuses a staged row its own domain's schema refuses, naming the row", () => {
    const { rows } = staged();
    const voice = rows.items.find((item) => item.part === "owner-voice")!;
    const items = rows.items.map((item) => (item === voice ? { ...item, payload: { surface: "slack" } } : item));

    expect(unwrapErr(reconstructStagedImport({ ...rows, items }))).toMatchObject({
      code: "IMPORT_STAGED_PAYLOAD_INVALID",
      key: voice.key,
      part: "owner-voice",
    });
  });

  it("refuses a directive overlay that no longer decodes whole, naming the part rather than a row", () => {
    const { rows } = staged();
    const items = rows.items.map((item) => (item.part === "owner-directives" ? { ...item, payload: { id: 1 } } : item));

    expect(unwrapErr(reconstructStagedImport({ ...rows, items }))).toMatchObject({
      code: "IMPORT_STAGED_PAYLOAD_INVALID",
      key: null,
      part: "owner-directives",
    });
  });

  it("refuses a staged standing ask that is not an object", () => {
    const { rows } = staged();
    const items = rows.items.map((item) => (item.part === "standing-asks" ? { ...item, payload: "org-intel" } : item));

    expect(unwrapErr(reconstructStagedImport({ ...rows, items }))).toMatchObject({
      code: "IMPORT_STAGED_PAYLOAD_INVALID",
      key: "org-intel",
      part: "standing-asks",
    });
  });

  it("refuses a staged standing ask carrying a journal kind, rather than masking it", () => {
    const { rows } = staged();
    const items = rows.items.map((item) =>
      item.part === "standing-asks" ? { ...item, payload: Object.assign({ kind: "withdrawn" }, item.payload) } : item,
    );

    expect(unwrapErr(reconstructStagedImport({ ...rows, items }))).toEqual(
      StoreImportApplyErrors.payloadInvalid({
        key: "org-intel",
        part: "standing-asks",
        why: "it carries a journal kind, which a staged ask never does",
      }),
    );
  });

  it("refuses a staged payload carrying a field its strict parser does not read", () => {
    const { rows } = staged();
    const memory = rows.items.find((item) => item.part === "memories")!;
    const items = rows.items.map((item) =>
      item === memory ? { ...item, payload: Object.assign({ unexpected: true }, item.payload) } : item,
    );

    expect(unwrapErr(reconstructStagedImport({ ...rows, items }))).toEqual(
      StoreImportApplyErrors.payloadInvalid({
        key: memory.key,
        part: "memories",
        why: "its payload is not the row it decodes to: it carries a field, or a spelling, the export never wrote",
      }),
    );
  });

  it("accepts a staged payload whose keys come back in another order, as jsonb returns them", () => {
    const { rows } = staged();
    const items = rows.items.map((item) =>
      item.part === "memories"
        ? { ...item, payload: Object.fromEntries(Object.entries(Object(item.payload)).toReversed()) }
        : item,
    );

    expect(unwrap(reconstructStagedImport({ ...rows, items })).imported).toEqual(
      unwrap(reconstructStagedImport(rows)).imported,
    );
  });

  it("refuses a row of a part the batch records no export carrying", () => {
    const { rows } = staged();
    const parts = rows.parts.filter((part) => part !== "memories");

    expect(unwrapErr(reconstructStagedImport({ ...rows, parts })).message).toContain(
      "is of memories, a part the batch records no export carrying",
    );
  });

  it("refuses a question about a row the batch does not hold", () => {
    const { rows } = staged();
    const questions = rows.questions.map((question, at) => (at === 0 ? { ...question, key: "absent" } : question));

    expect(unwrapErr(reconstructStagedImport({ ...rows, questions })).message).toContain(
      `question ${rows.questions[0]!.id} asks about ${rows.questions[0]!.part} row absent`,
    );
  });

  it("refuses an answer naming no staged question, a second answer to one, and one its question does not take", () => {
    const { rows } = staged();
    const first = rows.questions[0]!.id;

    expect(
      [
        [{ action: "activate", questionId: "import-q-ffffffffffffffff" }],
        [
          { action: "activate", questionId: first },
          { action: "leave-inactive", questionId: first },
        ],
        [{ action: "take-imported", questionId: first }],
      ].map((resolutions) => unwrapErr(reconstructStagedImport({ ...rows, resolutions })).code),
    ).toEqual(["IMPORT_STAGED_BATCH_INCOMPLETE", "IMPORT_STAGED_BATCH_INCOMPLETE", "IMPORT_STAGED_BATCH_INCOMPLETE"]);
  });
});

describe("applicationReadiness", () => {
  it("waits on every restored instruction's activation, naming each", () => {
    const { draft, rows } = staged();
    const read = unwrap(reconstructStagedImport(rows));

    expect(
      unwrapErr(
        applicationReadiness({
          replanned: replan({ import: read, live: EMPTY_LIVE }),
          staged: read,
          stopOnConflict: false,
        }),
      ),
    ).toEqual(StoreImportApplyErrors.questionsOpen({ batchId: BATCH_ID, questionIds: questionIds({ draft }) }));
  });

  it("applies once every activation is answered, with no append-only difference to report", () => {
    const { draft, rows } = staged();
    const resolutions = questionIds({ draft }).map((questionId) => ({ action: "leave-inactive", questionId }));
    const read = unwrap(reconstructStagedImport({ ...rows, resolutions }));
    const ready = unwrap(
      applicationReadiness({
        replanned: replan({ import: read, live: EMPTY_LIVE }),
        staged: read,
        stopOnConflict: false,
      }),
    );

    expect([ready.plan.digest, ready.appendOnlyDifferences, ready.openAlignmentQuestionIds]).toEqual([
      draft.planDigest,
      [],
      [],
    ]);
  });

  it("never waits on an append-only difference: it reports it, the live row standing, unacknowledged", () => {
    const live = liveOf({ contents: { ...ACTIVE, memoryLines: [CHANGED_MEMORY_LINE] } });
    const { draft, rows } = staged({ live });
    const read = unwrap(reconstructStagedImport(rows));
    const ready = unwrap(
      applicationReadiness({ replanned: replan({ import: read, live }), staged: read, stopOnConflict: false }),
    );
    const [question] = draft.questions;

    expect(draft.questions.map((one) => [one.kind, one.part])).toEqual([["alignment", "memories"]]);
    expect(ready.appendOnlyDifferences).toEqual([
      {
        current: question!.live,
        imported: question!.imported,
        key: question!.key,
        part: "memories",
        questionId: question!.id,
        resolved: false,
      },
    ]);
    expect(ready.openAlignmentQuestionIds).toEqual([question!.id]);
  });

  it("reports an acknowledged difference as resolved, and no alignment left open", () => {
    const live = liveOf({ contents: { ...ACTIVE, memoryLines: [CHANGED_MEMORY_LINE] } });
    const probe = staged({ live });
    const resolutions = questionIds({ draft: probe.draft }).map((questionId) => ({
      action: "keep-current",
      questionId,
    }));
    const read = unwrap(reconstructStagedImport({ ...probe.rows, resolutions }));
    const ready = unwrap(
      applicationReadiness({ replanned: replan({ import: read, live }), staged: read, stopOnConflict: false }),
    );

    expect([ready.appendOnlyDifferences.map((one) => one.resolved), ready.openAlignmentQuestionIds]).toEqual([
      [true],
      [],
    ]);
  });

  it("stops a strict apply on any append-only difference, acknowledged or not, naming every one", () => {
    const live = liveOf({ contents: { ...ACTIVE, memoryLines: [CHANGED_MEMORY_LINE] } });
    const probe = staged({ live });
    const resolutions = questionIds({ draft: probe.draft }).map((questionId) => ({
      action: "keep-current",
      questionId,
    }));
    const read = unwrap(reconstructStagedImport({ ...probe.rows, resolutions }));
    const refused = unwrapErr(
      applicationReadiness({ replanned: replan({ import: read, live }), staged: read, stopOnConflict: true }),
    );

    expect([refused.code, refused.message]).toEqual([
      "IMPORT_APPEND_ONLY_CONFLICT",
      `batch ${BATCH_ID} differs from the live store in 1 append-only row(s), and a strict apply stops on any: memories ${probe.draft.questions[0]!.key}`,
    ]);
  });

  it("refuses a batch whose new recall counts a memory an import-key alignment keeps out, naming both", () => {
    const keyed = { ...(JSON.parse(MEMORY_LINE) as Record<string, unknown>), importKey: "acme-import-key-1" };
    const holder = JSON.stringify({
      ...keyed,
      id: "l-0000000000000002",
      recordingId: "bbbbbbbb-0000-4000-8000-000000000002",
    });
    const live = liveOf({ contents: { ...ACTIVE, memoryLines: [holder], recallLines: [] } });
    const probe = staged({ contents: { ...ACTIVE, memoryLines: [JSON.stringify(keyed)] }, live });
    const read = unwrap(reconstructStagedImport(probe.rows));
    const refused = unwrapErr(
      applicationReadiness({ replanned: replan({ import: read, live }), staged: read, stopOnConflict: false }),
    );
    const alignment = probe.draft.questions.find((question) => question.kind === "alignment")!;

    expect(refused).toEqual(
      StoreImportApplyErrors.dependencyUnmet({
        alignmentQuestionIds: [alignment.id],
        batchId: BATCH_ID,
        unmet: [
          {
            key: "cccccccc-0000-4000-8000-000000000001",
            needs: "recording bbbbbbbb-0000-4000-8000-000000000001 of claim l-0000000000000001",
            part: "memory-recalls",
          },
        ],
      }),
    );
  });

  it("waits on a conflict a part an answer may replace raises, and applies once it is answered", () => {
    const live = liveOf({ contents: { ...ACTIVE, owner: { ...OWNER, displayName: "Acme Owner, renamed" } } });
    const probe = staged({ live });
    const open = unwrap(reconstructStagedImport(probe.rows));
    const answered = unwrap(
      reconstructStagedImport({
        ...probe.rows,
        resolutions: questionIds({ draft: probe.draft }).map((questionId) => ({ action: "take-imported", questionId })),
      }),
    );

    expect(probe.draft.questions.map((one) => [one.kind, one.part])).toEqual([["conflict", "owner-profile"]]);
    expect(
      unwrapErr(
        applicationReadiness({ replanned: replan({ import: open, live }), staged: open, stopOnConflict: false }),
      ).code,
    ).toBe("IMPORT_QUESTIONS_OPEN");
    expect(
      unwrap(
        applicationReadiness({ replanned: replan({ import: answered, live }), staged: answered, stopOnConflict: true }),
      ).appendOnlyDifferences,
    ).toEqual([]);
  });

  it("refuses a batch the live store has moved past, naming both plans", () => {
    const { draft, rows } = staged();
    const read = unwrap(reconstructStagedImport(rows));
    const moved = replan({ import: read, live: liveOf({ contents: ACTIVE }) });

    expect(unwrapErr(applicationReadiness({ replanned: moved, staged: read, stopOnConflict: false }))).toEqual(
      StoreImportApplyErrors.batchStale({
        batchId: BATCH_ID,
        currentPlanDigest: moved.digest,
        stagedPlanDigest: draft.planDigest,
        why: "it no longer plans to the staged plan: the live store has moved since it was staged, or a staged row is not one the plan was made of",
      }),
    );
  });

  it("refuses a batch whose staged memory's seq changed after staging, a field its fingerprint leaves out", () => {
    const { draft, rows } = staged();
    const items = rows.items.map((item) =>
      item.part === "memories" ? { ...item, payload: { ...(item.payload as Record<string, unknown>), seq: 5 } } : item,
    );
    const read = unwrap(reconstructStagedImport({ ...rows, items }));
    const replanned = replan({ import: read, live: EMPTY_LIVE });
    const refused = unwrapErr(applicationReadiness({ replanned, staged: read, stopOnConflict: false }));

    expect([refused.code, replanned.digest === draft.planDigest]).toEqual(["IMPORT_BATCH_STALE", false]);
  });

  it.each([
    [4, "it was staged under comparison version 4, and this build compares by version 5"],
    [null, "it was staged before batches recorded their comparison version"],
  ])("refuses a batch staged under comparison version %j", (comparisonVersion, why) => {
    const { rows } = staged();
    const read = unwrap(reconstructStagedImport({ ...rows, batch: { ...rows.batch, comparisonVersion } }));
    const refused = unwrapErr(
      applicationReadiness({
        replanned: replan({ import: read, live: EMPTY_LIVE }),
        staged: read,
        stopOnConflict: false,
      }),
    );

    expect([refused.code, refused.message]).toEqual([
      "IMPORT_BATCH_STALE",
      `batch ${BATCH_ID} is stale: ${why}; stage the export again and answer its questions`,
    ]);
  });

  it("refuses a fresh plan compared by another version, its digest and questions alike", () => {
    const { rows } = staged();
    const read = unwrap(reconstructStagedImport(rows));
    const replanned = { ...replan({ import: read, live: EMPTY_LIVE }), comparisonVersion: 4 };
    const refused = unwrapErr(applicationReadiness({ replanned, staged: read, stopOnConflict: false }));

    expect(refused.message).toBe(
      `batch ${BATCH_ID} is stale: its fresh plan was compared by version 4, not the staged version 5; stage the export again and answer its questions`,
    );
  });

  it("refuses a batch whose staged questions are not the ones its plan asks, the digest alike", () => {
    const { rows } = staged();
    const questions = rows.questions.map((question, at) => (at === 0 ? { ...question, imported: "edited" } : question));
    const read = unwrap(reconstructStagedImport({ ...rows, questions }));
    const refused = unwrapErr(
      applicationReadiness({
        replanned: replan({ import: read, live: EMPTY_LIVE }),
        staged: read,
        stopOnConflict: false,
      }),
    );

    expect(refused.message).toBe(
      `batch ${BATCH_ID} is stale: its staged questions are not the ones its plan asks; stage the export again and answer its questions`,
    );
  });
});
