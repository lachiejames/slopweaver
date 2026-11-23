/**
 * One batch's life on a REAL Postgres, from staging to its first two answers: the one transaction and the unique
 * content digest settling a race, the seal on a staged batch, a batch nobody answered staying removable only whole,
 * and the CHECKs and immutability tying an answer to its question — what no pure test can settle.
 *
 * OPT-IN, and never in CI: it needs a running local stack, and there is none in any lane. It is handed the
 * stack's ADMIN connection, creates its own throwaway database from it, migrates that, and drops it
 * afterwards — it never touches the database the admin URL names:
 *
 *   STORE_IMPORT_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/storeImportStaging/
 *
 * The cases run in order over one database, each reading what the one before it left.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { StoreClient } from "../../../store/client.js";
import {
  storeImportBatchTable,
  storeImportItemTable,
  storeImportQuestionTable,
  storeImportResolutionTable,
} from "../../../store/schema/importStaging.js";
import { listUnresolvedImportQuestions, recordImportResolution } from "../../../store/transfer/importAnswers.js";
import { stageImport } from "../../../store/transfer/importStore.js";
import type { ImportStageDraft } from "../../../store/transfer/staged.js";
import { ADMIN_URL } from "../storeImportApplyHarness.js";
import { openStagingProof, type StagingProof, tableCounts } from "./harness.js";

describe.skipIf(ADMIN_URL === undefined)("store import staging on a real Postgres (opt-in)", () => {
  // Built in `beforeAll`, never at collection: `skipIf` still runs this body, and with no URL set a
  // collection-time `new URL(undefined)` throws before the skip can apply.
  let proof: StagingProof;
  let first: StoreClient;
  let second: StoreClient;
  let draft: ImportStageDraft;
  let batchId: string;

  beforeAll(async () => {
    proof = await openStagingProof();
    ({ draft, first, second } = proof);
  }, 120_000);

  afterAll(async () => {
    await proof.close();
  });

  it("stages one batch, every row and every question, in one transaction, from two racing stagings", async () => {
    expect(draft.questions.length).toBeGreaterThan(0);
    const [one, two] = await Promise.all([
      stageImport({ client: first, draft }),
      stageImport({ client: second, draft }),
    ]);
    const outcomes = [unwrap(one), unwrap(two)].map((outcome) => outcome.outcome).toSorted();
    expect(outcomes).toEqual(["already-staged", "staged"]);
    batchId = unwrap(one).batchId;
    expect(unwrap(two).batchId).toBe(batchId);
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 0]);
  });

  it("writes nothing when the same export is staged again", async () => {
    const again = unwrap(await stageImport({ client: first, draft }));
    expect([again.outcome, again.writes, again.items, again.questions]).toEqual([
      "already-staged",
      0,
      draft.items.length,
      draft.questions.length,
    ]);
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 0]);
  });

  it("refuses appending a row to a batch already staged, which its staging transaction sealed", async () => {
    await expect(
      first.db.insert(storeImportItemTable).values({
        batchId,
        fingerprint: `sha256:${"0".repeat(64)}`,
        itemKey: "acme-forged",
        ordinal: 2_147_483_647,
        part: "memories",
        payload: {},
        summary: "acme forged",
      }),
    ).rejects.toMatchObject({
      cause: {
        message: `store import batch ${batchId} is sealed: a store_import_item row is added only while the batch is staged`,
      },
    });
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 0]);
  });

  it("seals a batch by its staging instant as well as its transaction id, which wraparound can reuse", async () => {
    const forged = first.db.transaction(async (stager) => {
      const [batch] = await stager
        .insert(storeImportBatchTable)
        .values({
          contentDigest: `sha256:${"3".repeat(64)}`,
          manifested: true,
          planDigest: `sha256:${"3".repeat(64)}`,
          stagedAt: new Date("2000-01-01T00:00:00.000Z"),
        })
        .returning({ id: storeImportBatchTable.id });
      await stager.insert(storeImportItemTable).values({
        batchId: batch!.id,
        fingerprint: `sha256:${"3".repeat(64)}`,
        itemKey: "acme-wrapped",
        ordinal: 0,
        part: "memories",
        payload: {},
        summary: "acme wrapped",
      });
    });
    await expect(forged).rejects.toMatchObject({
      cause: {
        message: expect.stringMatching(/^store import batch .+ is sealed: a store_import_item row is added only/),
      },
    });
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 0]);
  });

  it("refuses a direct UPDATE of any staged row, since staging only inserts", async () => {
    await expect(first.db.update(storeImportBatchTable).set({ manifested: false })).rejects.toMatchObject({
      cause: { message: "a staged store_import_batch row is never changed: staging only inserts" },
    });
    await expect(first.db.update(storeImportQuestionTable).set({ importedSummary: "acme" })).rejects.toMatchObject({
      cause: { message: "a staged store_import_question row is never changed: staging only inserts" },
    });
  });

  it("refuses removing one row or question from a batch nobody has answered, which re-staging could not repair", async () => {
    const question = draft.questions[0]!;
    await expect(
      first.db.delete(storeImportQuestionTable).where(eq(storeImportQuestionTable.id, question.id)),
    ).rejects.toMatchObject({
      cause: { message: `a staged store_import_question row is removed only with its whole batch ${batchId}` },
    });
    await expect(first.db.delete(storeImportItemTable)).rejects.toMatchObject({
      cause: { message: `a staged store_import_item row is removed only with its whole batch ${batchId}` },
    });
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 0]);
  });

  it("removes a batch nobody has answered whole, and the same export then stages again", async () => {
    await first.db.delete(storeImportBatchTable);
    expect(await tableCounts({ client: first })).toEqual([0, 0, 0, 0]);
    const restaged = unwrap(await stageImport({ client: first, draft }));
    batchId = restaged.batchId;
    expect(restaged.outcome).toBe("staged");
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 0]);
  });

  it("waits on a whole-batch removal racing a re-stage, then stages afresh rather than report a batch that is gone", async () => {
    let restaging: ReturnType<typeof stageImport> | undefined;
    await second.db.transaction(async (remover) => {
      await remover.delete(storeImportBatchTable);
      restaging = stageImport({ client: first, draft });
      // Long enough that a re-stage reading the batch unlocked would read all of it before this removal commits.
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const restaged = unwrap(await restaging!);
    expect(restaged.outcome).toBe("staged");
    expect(restaged.batchId).not.toBe(batchId);
    batchId = restaged.batchId;
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 0]);
  });

  it("refuses an answer to a question nobody staged", async () => {
    const refused = unwrapErr(
      await recordImportResolution({ action: "activate", client: first, questionId: "import-q-00000000000000ff" }),
    );
    expect(refused.code).toBe("IMPORT_QUESTION_NOT_STAGED");
  });

  it("refuses an answer from the other kind's vocabulary and records nothing", async () => {
    const question = draft.questions[0]!;
    const wrong = question.kind === "activation" ? "take-imported" : "activate";
    const refused = unwrapErr(await recordImportResolution({ action: wrong, client: first, questionId: question.id }));
    expect(refused.code).toBe("IMPORT_ACTION_INVALID");
    expect((await tableCounts({ client: first }))[3]).toBe(0);
  });

  it("records one answer, takes its question off the open list, and writes nothing on the same answer again", async () => {
    const question = draft.questions[0]!;
    const answer = question.kind === "activation" ? "leave-inactive" : "keep-current";
    const recorded = unwrap(await recordImportResolution({ action: answer, client: first, questionId: question.id }));
    expect([recorded.outcome, recorded.writes]).toEqual(["recorded", 1]);
    const open = unwrap(await listUnresolvedImportQuestions({ client: first }));
    expect(open.map((row) => row.questionId)).toEqual(draft.questions.slice(1).map((row) => row.id));
    const again = unwrap(await recordImportResolution({ action: answer, client: first, questionId: question.id }));
    expect([again.outcome, again.writes]).toEqual(["already-recorded", 0]);
  });

  it("refuses a different second answer and keeps the first", async () => {
    const question = draft.questions[0]!;
    const other = question.kind === "activation" ? "activate" : "take-imported";
    const refused = unwrapErr(await recordImportResolution({ action: other, client: first, questionId: question.id }));
    expect(refused.code).toBe("IMPORT_QUESTION_ALREADY_RESOLVED");
    const [kept] = await first.db
      .select({ action: storeImportResolutionTable.action })
      .from(storeImportResolutionTable);
    expect(kept!.action).toBe(question.kind === "activation" ? "leave-inactive" : "keep-current");
  });

  it("refuses a direct UPDATE of a recorded answer in the database itself, whoever issues it", async () => {
    const question = draft.questions[0]!;
    const other = question.kind === "activation" ? "activate" : "take-imported";
    await expect(
      first.db
        .update(storeImportResolutionTable)
        .set({ action: other })
        .where(eq(storeImportResolutionTable.questionId, question.id)),
    ).rejects.toMatchObject({
      cause: { message: `store import answer ${question.id} is recorded and is never changed` },
    });
    const [kept] = await first.db
      .select({ action: storeImportResolutionTable.action })
      .from(storeImportResolutionTable)
      .where(eq(storeImportResolutionTable.questionId, question.id));
    expect(kept!.action).toBe(question.kind === "activation" ? "leave-inactive" : "keep-current");
  });

  it("records one of two different answers racing over two connections and refuses the other by name", async () => {
    expect(draft.questions.length).toBeGreaterThan(1);
    const question = draft.questions[1]!;
    const answers = question.kind === "activation" ? ["activate", "leave-inactive"] : ["keep-current", "take-imported"];
    const [one, two] = await Promise.all([
      recordImportResolution({ action: answers[0]!, client: first, questionId: question.id }),
      recordImportResolution({ action: answers[1]!, client: second, questionId: question.id }),
    ]);
    const outcomes = [one, two].map((result) => (result.isOk() ? result.value.outcome : result.error.code)).toSorted();
    expect(outcomes).toEqual(["IMPORT_QUESTION_ALREADY_RESOLVED", "recorded"]);
    expect((await tableCounts({ client: first }))[3]).toBe(2);
  });

  it("refuses deleting a recorded answer, so it cannot be replaced by another", async () => {
    const question = draft.questions[0]!;
    await expect(
      first.db.delete(storeImportResolutionTable).where(eq(storeImportResolutionTable.questionId, question.id)),
    ).rejects.toMatchObject({
      cause: { message: `store import answer ${question.id} is recorded and is never changed` },
    });
    const other = question.kind === "activation" ? "activate" : "take-imported";
    const refused = unwrapErr(await recordImportResolution({ action: other, client: first, questionId: question.id }));
    expect([refused.code, (await tableCounts({ client: first }))[3]]).toEqual(["IMPORT_QUESTION_ALREADY_RESOLVED", 2]);
  });
});
