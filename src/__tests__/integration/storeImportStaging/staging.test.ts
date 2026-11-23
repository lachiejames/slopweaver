/**
 * Staging a store export on a REAL Postgres before any batch stands: the session pinned to the real tables, a stale
 * approval refused, a batch from another comparison version or another plan never read as this export's, the
 * comparison-version CHECK, and a payload differing only past 2^53 — what no pure test can settle.
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
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { StoreClient } from "../../../store/client.js";
import {
  storeImportBatchTable,
  storeImportItemTable,
  storeImportPartTable,
  storeImportQuestionTable,
} from "../../../store/schema/importStaging.js";
import { type ImportPlan, STORE_IMPORT_COMPARISON_VERSION } from "../../../store/transfer/compare.js";
import { listUnresolvedImportQuestions, recordImportResolution } from "../../../store/transfer/importAnswers.js";
import { realTablesOnly, stagingGuardsInstalled } from "../../../store/transfer/importSession.js";
import { stageImport } from "../../../store/transfer/importStore.js";
import { approveImportPlan, type ImportStageDraft } from "../../../store/transfer/staged.js";
import { ADMIN_URL } from "../storeImportApplyHarness.js";
import { openStagingProof, type StagingProof, tableCounts } from "./harness.js";

describe.skipIf(ADMIN_URL === undefined)("store import staging on a real Postgres (opt-in)", () => {
  // Built in `beforeAll`, never at collection: `skipIf` still runs this body, and with no URL set a
  // collection-time `new URL(undefined)` throws before the skip can apply.
  let proof: StagingProof;
  let first: StoreClient;
  let plan: ImportPlan;
  let draft: ImportStageDraft;

  beforeAll(async () => {
    proof = await openStagingProof();
    ({ draft, first, plan } = proof);
  }, 120_000);

  afterAll(async () => {
    await proof.close();
  });

  it("pins the session's tables to the real ones and finds every staging guard on a store whose apply finished", async () => {
    const [path, guarded] = await first.db.transaction(async (writer) => {
      await realTablesOnly({ writer });
      const [shown] = await writer.execute<{ search_path: string }>(sql`show search_path`);
      return [shown!.search_path, await stagingGuardsInstalled({ writer })] as const;
    });
    expect([path, unwrap(guarded)]).toEqual(["pg_catalog, public, pg_temp", null]);
  });

  it("refuses a stale approval before anything is written", async () => {
    expect(unwrapErr(approveImportPlan({ approved: `sha256:${"0".repeat(64)}`, plan })).code).toBe(
      "IMPORT_APPROVAL_MISMATCH",
    );
    expect(await tableCounts({ client: first })).toEqual([0, 0, 0, 0]);
  });

  it("never reads a batch staged before batches recorded a comparison version as this export's", async () => {
    const [older] = await first.db
      .insert(storeImportBatchTable)
      .values({ contentDigest: draft.contentDigest, manifested: draft.manifested, planDigest: draft.planDigest })
      .returning({ id: storeImportBatchTable.id });
    const refused = unwrapErr(await stageImport({ client: first, draft }));
    expect([refused.code, refused.message]).toEqual([
      "IMPORT_BATCH_MISMATCH",
      `batch ${older!.id} already holds ${draft.contentDigest} but not what this export stages ` +
        "(it was staged before batches recorded their comparison version); nothing was staged and the batch was not trusted",
    ]);
    expect(await tableCounts({ client: first })).toEqual([1, 0, 0, 0]);
    await first.db.delete(storeImportBatchTable);
  });

  it("never reads a batch under another comparison version as this export's, rows and plan otherwise exact", async () => {
    const other = STORE_IMPORT_COMPARISON_VERSION + 1;
    const [newer] = await first.db
      .insert(storeImportBatchTable)
      .values({
        comparisonVersion: other,
        contentDigest: draft.contentDigest,
        manifested: draft.manifested,
        planDigest: draft.planDigest,
      })
      .returning({ id: storeImportBatchTable.id });
    const refused = unwrapErr(await stageImport({ client: first, draft }));
    expect([refused.code, refused.message]).toEqual([
      "IMPORT_BATCH_MISMATCH",
      `batch ${newer!.id} already holds ${draft.contentDigest} but not what this export stages ` +
        `(it was staged under comparison version ${String(other)}, and this build compares by version ` +
        `${String(STORE_IMPORT_COMPARISON_VERSION)}); nothing was staged and the batch was not trusted`,
    ]);
    expect(await tableCounts({ client: first })).toEqual([1, 0, 0, 0]);
    await first.db.delete(storeImportBatchTable);
  });

  it("neither lists nor answers a question from a batch staged under no or another comparison version", async () => {
    const other = STORE_IMPORT_COMPARISON_VERSION + 1;
    const versions = [
      { comparisonVersion: null, staged: "before batches recorded their comparison version" },
      { comparisonVersion: other, staged: `under comparison version ${String(other)}` },
    ] as const;
    const [head] = draft.items;
    for (const { comparisonVersion, staged } of versions) {
      const questionId = "import-q-00000000000000aa";
      await first.db.transaction(async (forger) => {
        const [batch] = await forger
          .insert(storeImportBatchTable)
          .values({
            comparisonVersion,
            contentDigest: `sha256:${"7".repeat(64)}`,
            manifested: true,
            planDigest: draft.planDigest,
          })
          .returning({ id: storeImportBatchTable.id });
        await forger.insert(storeImportPartTable).values({ batchId: batch!.id, part: head!.part });
        await forger.insert(storeImportItemTable).values({
          batchId: batch!.id,
          fingerprint: head!.fingerprint,
          itemKey: head!.key,
          ordinal: 0,
          part: head!.part,
          payload: head!.payload,
          summary: head!.summary,
        });
        await forger.insert(storeImportQuestionTable).values({
          batchId: batch!.id,
          id: questionId,
          importedSummary: head!.summary,
          itemKey: head!.key,
          kind: "activation",
          part: head!.part,
        });
      });
      expect(unwrap(await listUnresolvedImportQuestions({ client: first }))).toEqual([]);
      const refused = unwrapErr(await recordImportResolution({ action: "activate", client: first, questionId }));
      expect([refused.code, refused.message]).toEqual([
        "IMPORT_QUESTION_STALE",
        `${questionId} was staged ${staged}, ` +
          `and this build compares by version ${String(STORE_IMPORT_COMPARISON_VERSION)}; it is not a question this ` +
          "build would ask, so no answer was recorded — the export has to be staged again",
      ]);
      expect(await tableCounts({ client: first })).toEqual([1, 1, 1, 0]);
      await first.db.delete(storeImportBatchTable);
    }
    expect(await tableCounts({ client: first })).toEqual([0, 0, 0, 0]);
  });

  it("refuses a comparison version the store's own CHECK does not allow", async () => {
    await expect(
      first.db.insert(storeImportBatchTable).values({
        comparisonVersion: 0,
        contentDigest: draft.contentDigest,
        manifested: true,
        planDigest: draft.planDigest,
      }),
    ).rejects.toMatchObject({ cause: { constraint_name: "store_import_batch_comparison_version" } });
    expect(await tableCounts({ client: first })).toEqual([0, 0, 0, 0]);
  });

  it("stages the same export under another plan as a batch of its own, never reading the other plan's as this one's", async () => {
    const otherPlan = `sha256:${"0".repeat(64)}`;
    const [earlier] = await first.db
      .insert(storeImportBatchTable)
      .values({
        comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
        contentDigest: draft.contentDigest,
        manifested: true,
        planDigest: otherPlan,
      })
      .returning({ id: storeImportBatchTable.id });
    const staged = unwrap(await stageImport({ client: first, draft }));
    expect(staged.outcome).toBe("staged");
    expect(staged.batchId).not.toBe(earlier!.id);
    const plans = await first.db
      .select({ plan: storeImportBatchTable.planDigest })
      .from(storeImportBatchTable)
      .where(eq(storeImportBatchTable.contentDigest, draft.contentDigest));
    expect(plans.map((row) => row.plan).toSorted()).toEqual([draft.planDigest, otherPlan].toSorted());
    await first.db.delete(storeImportBatchTable);
    expect(await tableCounts({ client: first })).toEqual([0, 0, 0, 0]);
  });

  it("refuses a hand-written batch whose payload differs only past 2^53, which JavaScript would read as the same", async () => {
    const [head, ...rest] = draft.items;
    const exact: ImportStageDraft = {
      ...draft,
      contentDigest: `sha256:${"5".repeat(64)}`,
      items: [{ ...head!, payload: { acmeCount: 9007199254740992 } }, ...rest],
      questions: [],
    };
    const forgedId = await first.db.transaction(async (forger) => {
      const [batch] = await forger
        .insert(storeImportBatchTable)
        .values({
          comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
          contentDigest: exact.contentDigest,
          manifested: exact.manifested,
          planDigest: exact.planDigest,
        })
        .returning({ id: storeImportBatchTable.id });
      await forger.insert(storeImportPartTable).values(exact.parts.map((part) => ({ batchId: batch!.id, part })));
      await forger.insert(storeImportItemTable).values(
        exact.items.map((item, index) => ({
          batchId: batch!.id,
          fingerprint: item.fingerprint,
          itemKey: item.key,
          ordinal: item.ordinal,
          part: item.part,
          payload: index === 0 ? sql`'{"acmeCount": 9007199254740993}'::jsonb` : item.payload,
          summary: item.summary,
        })),
      );
      return batch!.id;
    });
    const refused = unwrapErr(await stageImport({ client: first, draft: exact }));
    expect([refused.code, refused.message]).toEqual([
      "IMPORT_BATCH_MISMATCH",
      `batch ${forgedId} already holds ${exact.contentDigest} but not what this export stages ` +
        "(its rows' payloads are not the export's); nothing was staged and the batch was not trusted",
    ]);
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, 0, 0]);
    await first.db.delete(storeImportBatchTable).where(eq(storeImportBatchTable.id, forgedId));
    const staged = unwrap(await stageImport({ client: first, draft: exact }));
    const again = unwrap(await stageImport({ client: first, draft: exact }));
    expect([staged.outcome, again.outcome, again.batchId]).toEqual(["staged", "already-staged", staged.batchId]);
    await first.db.delete(storeImportBatchTable).where(eq(storeImportBatchTable.id, staged.batchId));
    expect(await tableCounts({ client: first })).toEqual([0, 0, 0, 0]);
  });
});
