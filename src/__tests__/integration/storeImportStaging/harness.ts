/**
 * The shared fixture for every case under `src/__tests__/integration/storeImportStaging/`: one throwaway store per
 * test file from `src/__tests__/integration/storeImportApplyHarness.ts`, a second connection to it, the fixture export
 * planned against an empty store and drafted for staging, and the per-table row count each case asserts. Nothing
 * here touches the database the admin URL names. Synthetic organisation throughout.
 */
import { join } from "node:path";

import { count } from "drizzle-orm";

import { unwrap } from "#lib/result.js";

import { openStore, type StoreClient } from "../../../store/client.js";
import {
  storeImportBatchTable,
  storeImportItemTable,
  storeImportQuestionTable,
  storeImportResolutionTable,
} from "../../../store/schema/importStaging.js";
import { writeStoreExport } from "../../../store/transfer/bundlePublish.js";
import { contentDigest, readExportBundle } from "../../../store/transfer/bundleRead.js";
import { type ImportPlan, planImport } from "../../../store/transfer/compare.js";
import type { StoreExportPartKind } from "../../../store/transfer/parts.js";
import type { StagedEntry } from "../../../store/transfer/retained.js";
import { approveImportPlan, type ImportStageDraft, importStageDraft } from "../../../store/transfer/staged.js";
import { CONTENTS } from "../../unit/store/transfer/fixtures.js";
import { openAdmin, throwawayStore } from "../storeImportApplyHarness.js";

const EMPTY_LIVE: ReadonlyMap<StoreExportPartKind, readonly StagedEntry[]> = new Map([
  ["memories", []],
  ["memory-recalls", []],
  ["owner-profile", []],
  ["owner-voice", []],
  ["owner-directives", []],
  ["standing-asks", []],
  ["steer-verdicts", []],
]);

/**
 * How many rows each staging table holds now.
 *
 * @returns the batch, item, question and resolution row counts, in that order
 */
export async function tableCounts({ client }: { client: StoreClient }): Promise<readonly number[]> {
  const tables = [storeImportBatchTable, storeImportItemTable, storeImportQuestionTable, storeImportResolutionTable];
  const counted: number[] = [];
  for (const table of tables) {
    const [row] = await client.db.select({ rows: count() }).from(table);
    counted.push(row!.rows);
  }
  return counted;
}

/** One test file's throwaway store, two connections to it, and the fixture export planned and drafted for it. */
export interface StagingProof {
  readonly close: () => Promise<void>;
  readonly draft: ImportStageDraft;
  readonly first: StoreClient;
  readonly plan: ImportPlan;
  readonly second: StoreClient;
  readonly storeUrl: string;
}

/**
 * A fresh migrated store with a second connection to it, and the fixture export written beside it, planned against
 * an empty store, approved and drafted for staging.
 *
 * @returns the proof, whose `close` ends both connections, drops the store and removes the export
 */
export async function openStagingProof(): Promise<StagingProof> {
  const admin = openAdmin();
  const store = await throwawayStore({ admin });
  const first = store.client;
  const second = openStore({ url: store.url });
  const out = join(store.root, "export");
  unwrap(
    writeStoreExport({ contents: CONTENTS, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }),
  );
  const reading = unwrap(readExportBundle({ dir: out, unmanifested: false }));
  const plan = unwrap(
    planImport({
      contentDigest: contentDigest({ parts: reading.parts }),
      imported: reading.retained,
      live: EMPTY_LIVE,
    }),
  );
  const draft = unwrap(importStageDraft({ plan: unwrap(approveImportPlan({ approved: plan.digest, plan })), reading }));
  const close = async (): Promise<void> => {
    await second.close();
    await store.close();
    await admin.sql.end();
  };
  return { close, draft, first, plan, second, storeUrl: store.url };
}
