/**
 * The schema an applied store import stands on, on a REAL Postgres: one part row per part a batch carried, an empty
 * part included and an unread one absent, every staged row tied to a part its batch carried, the part rows guarded
 * exactly as a batch's other staged rows are, the apply receipt that is never changed and that keeps its batch, and
 * the CHECKs that let an inactive imported generation stand without a journal sequence and tie an owner-judgement
 * version's origin to its import question. None of it is a thing a pure test can settle.
 *
 * OPT-IN, and never in CI: it needs a running local stack. It creates its own throwaway database from the admin
 * connection, migrates it, and drops it afterwards — it never touches the database the admin URL names:
 *
 *   STORE_IMPORT_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/storeImportApplicationSchema.test.ts
 *
 * The cases run in order over one database, each reading what the one before it left.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap } from "../../lib/result.js";
import { openStore, type StoreClient, type StoreWriter } from "../../store/client.js";
import { applyStore } from "../../store/migrate.js";
import {
  storeImportApplicationTable,
  storeImportBatchTable,
  storeImportItemTable,
  storeImportPartTable,
} from "../../store/schema/importStaging.js";
import { ownerCorrectionTable, ownerDirectiveTable } from "../../store/schema/ownerJudgement.js";
import { standingAskTable } from "../../store/schema/standingAsks.js";
import { writeStoreExport } from "../../store/transfer/bundlePublish.js";
import { contentDigest, readExportBundle } from "../../store/transfer/bundleRead.js";
import { planImport } from "../../store/transfer/compare.js";
import { stageImport } from "../../store/transfer/importStore.js";
import type { StoreExportPartKind } from "../../store/transfer/parts.js";
import type { StagedEntry } from "../../store/transfer/retained.js";
import { approveImportPlan, type ImportStageDraft, importStageDraft } from "../../store/transfer/staged.js";
import { CONTENTS } from "../unit/store/transfer/fixtures.js";

const ADMIN_URL = process.env["STORE_IMPORT_PROOF_ADMIN_URL"];

const EMPTY_LIVE: ReadonlyMap<StoreExportPartKind, readonly StagedEntry[]> = new Map([
  ["memories", []],
  ["memory-recalls", []],
  ["owner-profile", []],
  ["owner-voice", []],
  ["owner-directives", []],
  ["standing-asks", []],
  ["steer-verdicts", []],
]);

const HASH = `sha256:${"a".repeat(64)}`;

/** The parts one batch carries, as the database holds them, sorted. */
async function partsOf({ client, batchId }: { client: StoreClient; batchId: string }): Promise<readonly string[]> {
  const rows = await client.db
    .select({ part: storeImportPartTable.part })
    .from(storeImportPartTable)
    .where(eq(storeImportPartTable.batchId, batchId));
  return rows.map((row) => row.part).toSorted();
}

/**
 * The draft a reading that never carried `missing` would stage: its part and rows gone, and no questions, since a
 * question's id is unique across batches and the first batch already holds every one this draft raised.
 */
function withoutPart({ draft, missing }: { draft: ImportStageDraft; missing: StoreExportPartKind }): ImportStageDraft {
  return {
    ...draft,
    contentDigest: `sha256:${"6".repeat(64)}`,
    items: draft.items.filter((item) => item.part !== missing),
    parts: draft.parts.filter((part) => part !== missing),
    questions: [],
  };
}

describe.skipIf(ADMIN_URL === undefined)("the store import application schema on a real Postgres (opt-in)", () => {
  const database = `store_import_apply_${randomUUID().slice(0, 8)}`;
  // Built in `beforeAll`, never at collection: `skipIf` still runs this body.
  let admin: postgres.Sql;
  let client: StoreClient;
  let root: string;
  let draft: ImportStageDraft;
  let batchId: string;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL!, { max: 1, onnotice: () => {} });
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${database}`;
    await admin.unsafe(`create database ${database}`);
    unwrap(await applyStore({ url: url.toString() }));
    client = openStore({ url: url.toString() });
    root = mkdtempSync(join(tmpdir(), "sw-import-apply-"));
    const out = join(root, "export");
    const contents = { ...CONTENTS, recallLines: [] };
    unwrap(writeStoreExport({ contents, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }));
    const reading = unwrap(readExportBundle({ dir: out, unmanifested: false }));
    const plan = unwrap(
      planImport({
        contentDigest: contentDigest({ parts: reading.parts }),
        imported: reading.retained,
        live: EMPTY_LIVE,
      }),
    );
    draft = unwrap(importStageDraft({ plan: unwrap(approveImportPlan({ approved: plan.digest, plan })), reading }));
  }, 120_000);

  afterAll(async () => {
    rmSync(root, { force: true, recursive: true });
    await client.close();
    await admin.unsafe(`drop database if exists ${database} with (force)`);
    await admin.end();
  });

  it("stages one part row per part the export carried, the empty one included, and counts each as a write", async () => {
    expect(draft.items.filter((item) => item.part === "memory-recalls")).toEqual([]);
    const staged = unwrap(await stageImport({ client, draft }));
    batchId = staged.batchId;
    expect([staged.outcome, staged.writes]).toEqual([
      "staged",
      1 + draft.parts.length + draft.items.length + draft.questions.length,
    ]);
    expect(await partsOf({ batchId, client })).toEqual([
      "memories",
      "memory-recalls",
      "owner-directives",
      "owner-profile",
      "owner-voice",
      "standing-asks",
      "steer-verdicts",
    ]);
  });

  it("stages no part row for a part the reading never carried, so the batch says it is absent rather than empty", async () => {
    const partial = withoutPart({ draft, missing: "owner-voice" });
    const staged = unwrap(await stageImport({ client, draft: partial }));
    expect(staged.writes).toBe(1 + partial.parts.length + partial.items.length + partial.questions.length);
    expect((await partsOf({ batchId: staged.batchId, client })).includes("owner-voice")).toBe(false);
    expect((await partsOf({ batchId: staged.batchId, client })).length).toBe(6);
    await client.db.delete(storeImportBatchTable).where(eq(storeImportBatchTable.id, staged.batchId));
  });

  it("refuses a staged row naming a part its batch did not carry", async () => {
    const forged = client.db.transaction(async (stager) => {
      const [batch] = await stager
        .insert(storeImportBatchTable)
        .values({ contentDigest: `sha256:${"8".repeat(64)}`, manifested: true, planDigest: `sha256:${"8".repeat(64)}` })
        .returning({ id: storeImportBatchTable.id });
      await stager.insert(storeImportPartTable).values({ batchId: batch!.id, part: "memories" });
      await stager.insert(storeImportItemTable).values({
        batchId: batch!.id,
        fingerprint: HASH,
        itemKey: "acme-voice",
        ordinal: 0,
        part: "owner-voice",
        payload: {},
        summary: "acme voice",
      });
    });
    await expect(forged).rejects.toMatchObject({ cause: { constraint_name: "fk_store_import_item_part" } });
  });

  it("guards a batch's part rows as it guards its other staged rows", async () => {
    const one = and(eq(storeImportPartTable.batchId, batchId), eq(storeImportPartTable.part, "memory-recalls"));
    await expect(client.db.update(storeImportPartTable).set({ part: "memories" }).where(one)).rejects.toMatchObject({
      cause: { message: "a staged store_import_part row is never changed: staging only inserts" },
    });
    await expect(client.db.delete(storeImportPartTable).where(one)).rejects.toMatchObject({
      cause: { message: `a staged store_import_part row is removed only with its whole batch ${batchId}` },
    });
    await expect(client.db.execute(sql`truncate table store_import_part cascade`)).rejects.toMatchObject({
      cause: { message: "store_import_part is never truncated: a staged import is kept as it was written" },
    });
    expect((await partsOf({ batchId, client })).length).toBe(7);
  });

  it("refuses a part row added to a batch after its staging transaction sealed it", async () => {
    const partial = withoutPart({ draft, missing: "owner-voice" });
    const staged = unwrap(await stageImport({ client, draft: partial }));
    await expect(
      client.db.insert(storeImportPartTable).values({ batchId: staged.batchId, part: "owner-voice" }),
    ).rejects.toMatchObject({
      cause: {
        message: `store import batch ${staged.batchId} is sealed: a store_import_part row is added only while the batch is staged`,
      },
    });
    await client.db.delete(storeImportBatchTable).where(eq(storeImportBatchTable.id, staged.batchId));
  });

  it("refuses a receipt naming a plan its batch was not staged under, or claiming no writes", async () => {
    await expect(
      client.db
        .insert(storeImportApplicationTable)
        .values({ batchId, planDigest: `sha256:${"9".repeat(64)}`, writeCount: 3 }),
    ).rejects.toMatchObject({ cause: { constraint_name: "fk_store_import_application_batch" } });
    await expect(
      client.db.insert(storeImportApplicationTable).values({ batchId, planDigest: draft.planDigest, writeCount: 0 }),
    ).rejects.toMatchObject({ cause: { constraint_name: "store_import_application_write_count" } });
  });

  it("records one receipt per batch, and never changes, removes or truncates it", async () => {
    await client.db
      .insert(storeImportApplicationTable)
      .values({ batchId, planDigest: draft.planDigest, writeCount: 3 });
    await expect(
      client.db.insert(storeImportApplicationTable).values({ batchId, planDigest: draft.planDigest, writeCount: 4 }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    const immutable = `store import batch ${batchId} is applied, and its receipt is never changed`;
    await expect(client.db.update(storeImportApplicationTable).set({ writeCount: 9 })).rejects.toMatchObject({
      cause: { message: immutable },
    });
    await expect(client.db.delete(storeImportApplicationTable)).rejects.toMatchObject({
      cause: { message: immutable },
    });
    await expect(client.db.execute(sql`truncate table store_import_application`)).rejects.toMatchObject({
      cause: { message: "store_import_application is never truncated: a staged import is kept as it was written" },
    });
    const [kept] = await client.db.select().from(storeImportApplicationTable);
    expect([kept!.batchId, kept!.planDigest, kept!.writeCount]).toEqual([batchId, draft.planDigest, 3]);
  });

  it("keeps an applied batch: its removal is refused while the receipt stands", async () => {
    await expect(
      client.db.delete(storeImportBatchTable).where(eq(storeImportBatchTable.id, batchId)),
    ).rejects.toMatchObject({ cause: { constraint_name: "fk_store_import_application_batch" } });
    expect((await partsOf({ batchId, client })).length).toBe(7);
  });

  it("refuses writing a receipt or a part row in replica mode, where no foreign key checks", async () => {
    const inReplica = async ({ write }: { write: (writer: StoreWriter) => Promise<unknown> }): Promise<unknown> =>
      client.db.transaction(async (replica) => {
        await replica.execute(sql`set local session_replication_role = replica`);
        await write(replica);
      });
    await expect(
      inReplica({
        write: (writer) =>
          writer
            .insert(storeImportApplicationTable)
            .values({ batchId: randomUUID(), planDigest: draft.planDigest, writeCount: 1 }),
      }),
    ).rejects.toMatchObject({
      cause: {
        message:
          "store_import_application is written only with its foreign keys enforced, never in session_replication_role replica",
      },
    });
    await expect(
      inReplica({
        write: (writer) => writer.insert(storeImportPartTable).values({ batchId: randomUUID(), part: "memories" }),
      }),
    ).rejects.toMatchObject({
      cause: {
        message:
          "store_import_part is written only with its foreign keys enforced, never in session_replication_role replica",
      },
    });
  });

  it("lets an inactive imported generation stand with no journal sequence, and no other generation", async () => {
    const question = draft.questions[0]!;
    const generation = {
      askId: "acme-ask",
      quoteAnchor: "slack:acme/C0FIXTURE/1760000000.000100",
      quoteAt: "2026-10-01T00:00:00.000Z",
      quoteCut: "none",
      quoteWhere: "session",
      quoteWords: "draft first",
      recordedAt: "2026-10-01T00:00:00.000Z",
    } as const;
    await client.db.insert(standingAskTable).values({
      ...generation,
      importQuestionId: question.id,
      origin: "store-import",
      recordedSeq: null,
      state: "inactive",
    });
    const refusals = [
      { origin: "profile", recordedSeq: null, state: "active" },
      { importQuestionId: question.id, origin: "store-import", recordedSeq: 7, state: "inactive" },
      { importQuestionId: question.id, origin: "store-import", recordedSeq: null, state: "active" },
      { origin: "profile", recordedSeq: 0, state: "active" },
    ] as const;
    for (const refusal of refusals) {
      await expect(client.db.insert(standingAskTable).values({ ...generation, ...refusal })).rejects.toMatchObject({
        cause: { constraint_name: "standing_ask_recorded_seq" },
      });
    }
    const [stood] = await client.db.select({ seq: standingAskTable.recordedSeq }).from(standingAskTable);
    expect(stood!.seq).toBe(null);
  });

  it("ties an owner-judgement version's store-import origin to an import question, both ways", async () => {
    const question = draft.questions[0]!;
    const source = {
      sourceContentHash: HASH,
      sourceFile: "acme-rule.md",
      state: "inactive",
      text: "draft first",
    } as const;
    await expect(
      client.db.insert(ownerDirectiveTable).values({ ...source, directiveId: "d-acme", origin: "store-import" }),
    ).rejects.toMatchObject({ cause: { constraint_name: "owner_directive_import_origin" } });
    await expect(
      client.db
        .insert(ownerDirectiveTable)
        .values({ ...source, directiveId: "d-acme", importQuestionId: question.id, origin: "memory" }),
    ).rejects.toMatchObject({ cause: { constraint_name: "owner_directive_import_origin" } });
    const subject = { subjectContainer: "acme", subjectSource: "slack", subjectSourceId: "C0FIXTURE" } as const;
    await expect(
      client.db
        .insert(ownerCorrectionTable)
        .values({ ...source, ...subject, correctionId: "c-acme", origin: "store-import" }),
    ).rejects.toMatchObject({ cause: { constraint_name: "owner_correction_import_origin" } });
    await expect(
      client.db.insert(ownerCorrectionTable).values({
        ...source,
        ...subject,
        correctionId: "c-acme",
        importQuestionId: question.id,
        origin: "legacy-file",
      }),
    ).rejects.toMatchObject({ cause: { constraint_name: "owner_correction_import_origin" } });
    await client.db
      .insert(ownerDirectiveTable)
      .values({ ...source, directiveId: "d-acme", importQuestionId: question.id, origin: "store-import" });
    const [landed] = await client.db.select({ origin: ownerDirectiveTable.origin }).from(ownerDirectiveTable);
    expect(landed!.origin).toBe("store-import");
  });
});
