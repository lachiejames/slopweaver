/**
 * The immutability of a batch holding an answer on a REAL Postgres, against a direct INSERT, UPDATE, DELETE,
 * TRUNCATE or batch removal alike: every guard kept through a re-apply, installed on the real tables past look-alike
 * ones, firing in replica mode, refusing a disabled trigger, and never fooled by temporary tables of the same names —
 * what no pure test can settle.
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
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { StoreClient, StoreWriter } from "../../../store/client.js";
import { applyStore } from "../../../store/migrate.js";
import {
  IMPORT_STAGING_TRIGGERS,
  missingStagingTriggers,
  storeImportBatchTable,
  storeImportItemTable,
  storeImportPartTable,
  storeImportQuestionTable,
  storeImportResolutionTable,
} from "../../../store/schema/importStaging.js";
import { STORE_IMPORT_COMPARISON_VERSION } from "../../../store/transfer/compare.js";
import { recordImportResolution } from "../../../store/transfer/importAnswers.js";
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
  let storeUrl: string;

  beforeAll(async () => {
    proof = await openStagingProof();
    ({ draft, first, second, storeUrl } = proof);
    // The answered batch every case below reads, as `src/__tests__/integration/storeImportStaging/lifecycle.test.ts`
    // leaves it: one batch standing, its first question answered as that file answers it, its second answered once.
    batchId = unwrap(await stageImport({ client: first, draft })).batchId;
    const [answered, raced] = draft.questions;
    unwrap(
      await recordImportResolution({
        action: answered!.kind === "activation" ? "leave-inactive" : "keep-current",
        client: first,
        questionId: answered!.id,
      }),
    );
    unwrap(
      await recordImportResolution({
        action: raced!.kind === "activation" ? "activate" : "keep-current",
        client: first,
        questionId: raced!.id,
      }),
    );
  }, 120_000);

  afterAll(async () => {
    await proof.close();
  });

  it("refuses truncating any staging table, which no row trigger would see", async () => {
    await expect(first.db.execute(sql`truncate table store_import_resolution`)).rejects.toMatchObject({
      cause: { message: "store_import_resolution is never truncated: a staged import is kept as it was written" },
    });
    await expect(first.db.execute(sql`truncate table store_import_batch cascade`)).rejects.toMatchObject({
      cause: { message: "store_import_batch is never truncated: a staged import is kept as it was written" },
    });
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });

  it("refuses removing a batch that holds an answer, or any row or question staged in it", async () => {
    await expect(first.db.delete(storeImportBatchTable)).rejects.toMatchObject({
      cause: { message: `store import batch ${batchId} holds a recorded answer, so it is never removed` },
    });
    await expect(first.db.delete(storeImportItemTable)).rejects.toMatchObject({
      cause: { message: `a staged store_import_item row is removed only with its whole batch ${batchId}` },
    });
    await expect(first.db.delete(storeImportQuestionTable)).rejects.toMatchObject({
      cause: { message: `a staged store_import_question row is removed only with its whole batch ${batchId}` },
    });
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });

  it("keeps every guard through a re-apply of the store, which replaces each trigger in place", async () => {
    unwrap(await applyStore({ url: storeUrl }));
    const question = draft.questions[0]!;
    await expect(
      first.db.delete(storeImportResolutionTable).where(eq(storeImportResolutionTable.questionId, question.id)),
    ).rejects.toMatchObject({
      cause: { message: `store import answer ${question.id} is recorded and is never changed` },
    });
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });

  it("installs every guard on the real tables even when the apply's search path finds look-alike tables first", async () => {
    const tables = [...new Set(IMPORT_STAGING_TRIGGERS.map((trigger) => trigger.table))];
    await first.db.execute(sql`create schema acme_shadow`);
    try {
      for (const table of tables) {
        await first.db.execute(sql.raw(`create table acme_shadow.${table} (like public.${table} including defaults)`));
      }
      for (const trigger of IMPORT_STAGING_TRIGGERS) {
        await first.db.execute(sql.raw(`drop trigger ${trigger.name} on public.${trigger.table}`));
      }
      const shadowed = new URL(storeUrl);
      shadowed.searchParams.set("search_path", "acme_shadow,public");
      unwrap(await applyStore({ url: shadowed.toString() }));
      const installed = await first.db.execute<{ table: string; name: string }>(
        sql`select c.relname as "table", t.tgname as "name" from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
            where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled = 'A'`,
      );
      const [onShadow] = await first.db.execute<{ triggers: number }>(
        sql`select count(*)::int as "triggers" from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
            where c.relnamespace = 'acme_shadow'::regnamespace and not t.tgisinternal`,
      );
      expect([missingStagingTriggers({ installed }), onShadow!.triggers]).toEqual([[], 0]);
    } finally {
      await first.db.execute(sql`drop schema acme_shadow cascade`);
    }
  });

  it("fires every guard for a session in replica mode too, which an ordinary trigger would not", async () => {
    const question = draft.questions[0]!;
    await expect(
      second.db.transaction(async (replica) => {
        await replica.execute(sql`set local session_replication_role = replica`);
        await replica.delete(storeImportResolutionTable).where(eq(storeImportResolutionTable.questionId, question.id));
      }),
    ).rejects.toMatchObject({
      cause: { message: `store import answer ${question.id} is recorded and is never changed` },
    });
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });

  it("refuses removing an unanswered batch, or adding an answer, in replica mode, where no foreign key cascades or checks", async () => {
    const unanswered = await first.db.transaction(async (stager) => {
      const [batch] = await stager
        .insert(storeImportBatchTable)
        .values({ contentDigest: `sha256:${"2".repeat(64)}`, manifested: true, planDigest: `sha256:${"2".repeat(64)}` })
        .returning({ id: storeImportBatchTable.id });
      await stager.insert(storeImportPartTable).values({ batchId: batch!.id, part: "memories" });
      await stager.insert(storeImportItemTable).values({
        batchId: batch!.id,
        fingerprint: `sha256:${"2".repeat(64)}`,
        itemKey: "acme-unanswered",
        ordinal: 0,
        part: "memories",
        payload: {},
        summary: "acme unanswered",
      });
      return batch!.id;
    });
    const inReplica = async ({ write }: { write: (writer: StoreWriter) => Promise<unknown> }): Promise<unknown> =>
      second.db.transaction(async (replica) => {
        await replica.execute(sql`set local session_replication_role = replica`);
        await write(replica);
      });
    await expect(
      inReplica({
        write: (writer) => writer.delete(storeImportBatchTable).where(eq(storeImportBatchTable.id, unanswered)),
      }),
    ).rejects.toMatchObject({
      cause: {
        message:
          "store_import_batch is written only with its foreign keys enforced, never in session_replication_role replica",
      },
    });
    await expect(
      inReplica({
        write: (writer) =>
          writer
            .insert(storeImportResolutionTable)
            .values({ action: "activate", questionId: "import-q-00000000000000ff", questionKind: "activation" }),
      }),
    ).rejects.toMatchObject({
      cause: {
        message:
          "store_import_resolution is written only with its foreign keys enforced, never in session_replication_role replica",
      },
    });
    expect(await tableCounts({ client: first })).toEqual([2, draft.items.length + 1, draft.questions.length, 2]);
    await first.db.delete(storeImportBatchTable).where(eq(storeImportBatchTable.id, unanswered));
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });

  it("refuses staging or answering while a staging trigger is disabled or fires in origin mode only", async () => {
    const question = draft.questions[0]!;
    const message =
      "the store lacks 1 always-enabled import guard trigger(s) (trg_store_import_item_unchanged), as an apply " +
      "that never finished leaves it; none of the import's rows was written — `slopweaver store push` installs them";
    try {
      await first.db.execute(sql`alter table store_import_item disable trigger trg_store_import_item_unchanged`);
      const disabled = unwrapErr(await stageImport({ client: first, draft }));
      await first.db.execute(sql`alter table store_import_item enable trigger trg_store_import_item_unchanged`);
      const originOnly = unwrapErr(await stageImport({ client: first, draft }));
      const answering = unwrapErr(
        await recordImportResolution({ action: "activate", client: first, questionId: question.id }),
      );
      expect([disabled.message, originOnly.message, answering.message]).toEqual([message, message, message]);
    } finally {
      await first.db.execute(sql`alter table store_import_item enable always trigger trg_store_import_item_unchanged`);
    }
    expect(unwrap(await stageImport({ client: first, draft })).outcome).toBe("already-staged");
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });

  it("stages into the real tables, never a forged batch in temporary tables of the same names on its own session", async () => {
    const forgedDraft: ImportStageDraft = { ...draft, contentDigest: `sha256:${"4".repeat(64)}`, questions: [] };
    const shadowed = ["store_import_batch", "store_import_part", "store_import_item", "store_import_question"] as const;
    for (const table of shadowed) {
      await first.db.execute(sql.raw(`create temp table ${table} (like public.${table} including defaults)`));
    }
    let staged: Awaited<ReturnType<typeof stageImport>> | undefined;
    try {
      const [forged] = await first.db
        .insert(storeImportBatchTable)
        .values({
          comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
          contentDigest: forgedDraft.contentDigest,
          manifested: draft.manifested,
          planDigest: draft.planDigest,
        })
        .returning({ id: storeImportBatchTable.id });
      await first.db.insert(storeImportPartTable).values(draft.parts.map((part) => ({ batchId: forged!.id, part })));
      await first.db.insert(storeImportItemTable).values(
        draft.items.map((item) => ({
          batchId: forged!.id,
          fingerprint: item.fingerprint,
          itemKey: item.key,
          ordinal: item.ordinal,
          part: item.part,
          payload: item.payload,
          summary: item.summary,
        })),
      );
      staged = await stageImport({ client: first, draft: forgedDraft });
    } finally {
      for (const table of shadowed) {
        await first.db.execute(sql.raw(`drop table pg_temp.${table}`));
      }
    }
    const real = unwrap(staged);
    expect([real.outcome, real.writes]).toEqual(["staged", 1 + draft.parts.length + draft.items.length]);
    expect(await tableCounts({ client: first })).toEqual([2, 2 * draft.items.length, draft.questions.length, 2]);
    await first.db.delete(storeImportBatchTable).where(eq(storeImportBatchTable.id, real.batchId));
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });

  it("answers only a question in the real tables, never a forged one in temporary tables of the same names", async () => {
    const question = draft.questions[0]!;
    const answer = question.kind === "activation" ? "leave-inactive" : "keep-current";
    const forgedId = "import-q-00000000000000fe";
    const shadowed = ["store_import_question", "store_import_resolution"] as const;
    for (const table of shadowed) {
      await first.db.execute(sql.raw(`create temp table ${table} (like public.${table} including defaults)`));
    }
    let answered: Awaited<ReturnType<typeof recordImportResolution>> | undefined;
    try {
      await first.db.execute(
        sql`insert into pg_temp.store_import_question select * from public.store_import_question where id = ${question.id}`,
      );
      await first.db.execute(sql`update pg_temp.store_import_question set id = ${forgedId}`);
      answered = await recordImportResolution({ action: answer, client: first, questionId: forgedId });
    } finally {
      for (const table of shadowed) {
        await first.db.execute(sql.raw(`drop table pg_temp.${table}`));
      }
    }
    expect(unwrapErr(answered).code).toBe("IMPORT_QUESTION_NOT_STAGED");
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });

  it("refuses removing one row from a standing batch even when a temporary table shadows the batch table's name", async () => {
    const unasked = draft.items.find(
      (item) => !draft.questions.some((question) => question.part === item.part && question.key === item.key),
    )!;
    await expect(
      second.db.transaction(async (shadowing) => {
        await shadowing.execute(sql`create temp table store_import_batch (id uuid) on commit drop`);
        await shadowing
          .delete(storeImportItemTable)
          .where(and(eq(storeImportItemTable.batchId, batchId), eq(storeImportItemTable.itemKey, unasked.key)));
      }),
    ).rejects.toMatchObject({
      cause: { message: `a staged store_import_item row is removed only with its whole batch ${batchId}` },
    });
    expect(await tableCounts({ client: first })).toEqual([1, draft.items.length, draft.questions.length, 2]);
  });
});
