/**
 * A throwaway store an apply proof stages, answers and applies an export into: its own database created from the
 * admin connection and migrated, an empty installation home beside it, and both dropped when the case ends. Nothing
 * here touches the database the admin URL names. Synthetic organisation throughout.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { count, getTableName } from "drizzle-orm";
import postgres from "postgres";

import { type Result, unwrap } from "#lib/result.js";

import { type StandingAsk, standingAskLine } from "../../profile/standingAsks.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { applyStore } from "../../store/migrate.js";
import { storeImportApplicationTable } from "../../store/schema/importStaging.js";
import { memoriesTable } from "../../store/schema/memories.js";
import { memoryRecallsTable } from "../../store/schema/memoryRecalls.js";
import { ownerCorrectionTable, ownerDirectiveTable } from "../../store/schema/ownerJudgement.js";
import { ownerProfileTable } from "../../store/schema/ownerProfile.js";
import { ownerVoiceRegisterTable } from "../../store/schema/ownerVoice.js";
import { standingAskCoverageTable, standingAskEventTable, standingAskTable } from "../../store/schema/standingAsks.js";
import { steerMeasurementTable } from "../../store/schema/steerMeasurements.js";
import { type StoreExportContents, writeStoreExport } from "../../store/transfer/bundlePublish.js";
import { contentDigest, readExportBundle } from "../../store/transfer/bundleRead.js";
import { ensureRegistersImported, readStoreContentsIn } from "../../store/transfer/bundleWrite.js";
import { type ImportAction, planImport } from "../../store/transfer/compare.js";
import { recordImportResolution } from "../../store/transfer/importAnswers.js";
import { type ApplyStagedImportOutcome, applyStagedImport } from "../../store/transfer/importApply.js";
import type { StoreImportApplyError } from "../../store/transfer/importApplyErrors.js";
import { stageImport } from "../../store/transfer/importStore.js";
import { liveRetained } from "../../store/transfer/liveRetained.js";
import { approveImportPlan, type ImportStageDraft, importStageDraft } from "../../store/transfer/staged.js";

/** The admin connection the proofs create and drop their databases from; unset, they are skipped. */
export const ADMIN_URL = process.env["STORE_IMPORT_PROOF_ADMIN_URL"];

/** The admin connection and the address it was opened on: one value, so create, migrate and drop meet one server. */
export interface AdminConnection {
  readonly sql: postgres.Sql;
  readonly url: string;
}

/**
 * The admin connection the proofs create and drop their databases from, opened on `ADMIN_URL`.
 *
 * @returns the connection, carrying the address every throwaway database is derived from
 */
export function openAdmin(): AdminConnection {
  const url = ADMIN_URL!;
  return { sql: postgres(url, { max: 1, onnotice: () => {} }), url };
}

/** The instant an apply records a standing ask it replaces withdrawn at. */
const APPLIED_AT = "2026-11-02T00:00:00.000Z";

/** One throwaway store: its connection, its address, its empty home, and how to remove all of it. */
export interface ProofStore {
  readonly client: StoreClient;
  readonly url: string;
  readonly home: string;
  readonly root: string;
  readonly close: () => Promise<void>;
}

/** Every table an apply writes, its receipt's last. */
const WRITTEN = [
  ownerProfileTable,
  ownerVoiceRegisterTable,
  memoriesTable,
  memoryRecallsTable,
  ownerDirectiveTable,
  ownerCorrectionTable,
  standingAskTable,
  standingAskCoverageTable,
  standingAskEventTable,
  steerMeasurementTable,
  storeImportApplicationTable,
] as const;

/** One step of removing a throwaway store. */
type CleanupStep = () => Promise<void> | void;

/** Every step run in order, each attempted whatever an earlier one did; what each that failed threw. */
async function failuresOf({ steps }: { steps: readonly CleanupStep[] }): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

/** Every failure about one throwaway store, as one error that carries each of them. */
function allFailures({ failures, what }: { failures: readonly unknown[]; what: string }): AggregateError {
  return new AggregateError(failures, `${what}: ${failures.length} failure(s) bringing up or removing it`);
}

/**
 * A fresh database migrated to the current schema, and an empty home beside it.
 *
 * @param admin the admin connection the database is created from, migrated beside and later dropped from
 * @returns the open store, which its `close` removes whole
 */
export async function throwawayStore({ admin }: { admin: AdminConnection }): Promise<ProofStore> {
  const database = `store_import_apply_${randomUUID().slice(0, 8)}`;
  const address = new URL(admin.url);
  address.pathname = `/${database}`;
  const url = address.toString();
  const root = mkdtempSync(join(tmpdir(), "sw-import-apply-"));
  const removeRoot: CleanupStep = () => {
    rmSync(root, { force: true, recursive: true });
  };
  const dropDatabase: CleanupStep = async () => {
    await admin.sql.unsafe(`drop database if exists ${database} with (force)`);
  };
  // A database is dropped only once this call has created it: a name that already existed was never ours. A create
  // whose acknowledgement was lost may have committed, but a rejected create cannot show it is ours, so it is never
  // dropped here — the error thrown names the database instead, for an operator to look at.
  try {
    await admin.sql.unsafe(`create database ${database}`);
  } catch (error) {
    throw allFailures({ failures: [error, ...(await failuresOf({ steps: [removeRoot] }))], what: database });
  }
  // A store that fails to come up is removed here, since no caller ever holds a `close` for it.
  let client: StoreClient;
  try {
    unwrap(await applyStore({ url }));
    client = openStore({ url });
  } catch (error) {
    throw allFailures({
      failures: [error, ...(await failuresOf({ steps: [dropDatabase, removeRoot] }))],
      what: database,
    });
  }
  return {
    client,
    close: async () => {
      const failures = await failuresOf({ steps: [async () => client.close(), dropDatabase, removeRoot] });
      if (failures.length > 0) {
        throw allFailures({ failures, what: database });
      }
    },
    home: join(root, "home"),
    root,
    url,
  };
}

/**
 * Every store closed, each one attempted whatever another's close did, and every failure reported together.
 *
 * @param stores the stores a case opened, all of which are removed
 * @returns once every close has settled; it rejects with each failure when any close failed
 */
export async function closeAll({ stores }: { stores: readonly ProofStore[] }): Promise<void> {
  const settled = await Promise.allSettled(stores.map(async (store) => store.close()));
  const failures = settled.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} of ${stores.length} throwaway stores failed to close`);
  }
}

/**
 * An export of `contents` planned against what the store holds now, approved, staged, and each of its questions of a
 * kind `answers` names answered so.
 *
 * @param answers the action each question of a kind is answered with; a kind it does not name is left open
 * @returns the staged batch's id and the draft it was staged from
 */
export async function stagedAndAnswered({
  store,
  contents,
  answers,
}: {
  store: ProofStore;
  contents: StoreExportContents;
  answers: Partial<Record<"activation" | "conflict" | "alignment", ImportAction>>;
}): Promise<{ batchId: string; draft: ImportStageDraft }> {
  const { client, home } = store;
  unwrap(await ensureRegistersImported({ client, home }));
  const live = unwrap(liveRetained({ contents: unwrap(await readStoreContentsIn({ reader: client })) }));
  const out = join(store.root, `export-${randomUUID().slice(0, 8)}`);
  unwrap(writeStoreExport({ contents, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }));
  const reading = unwrap(readExportBundle({ dir: out, unmanifested: false }));
  const plan = unwrap(
    planImport({ contentDigest: contentDigest({ parts: reading.parts }), imported: reading.retained, live }),
  );
  const draft = unwrap(importStageDraft({ plan: unwrap(approveImportPlan({ approved: plan.digest, plan })), reading }));
  const { batchId } = unwrap(await stageImport({ client, draft }));
  for (const question of draft.questions) {
    const action = answers[question.kind];
    if (action !== undefined) {
      unwrap(await recordImportResolution({ action, client, questionId: question.id }));
    }
  }
  return { batchId, draft };
}

/**
 * The apply under proof, over `client` when one is given, else the store's own.
 *
 * @param stopOnConflict refuse the whole apply on any append-only difference
 * @param nowIso the instant a replaced standing ask is withdrawn at, a fixed valid one unless a case names its own
 * @returns what `applyStagedImport` returned
 */
export async function applied({
  store,
  batchId,
  client = store.client,
  stopOnConflict = false,
  nowIso = APPLIED_AT,
}: {
  store: ProofStore;
  batchId: string;
  client?: StoreClient;
  stopOnConflict?: boolean;
  nowIso?: string;
}): Promise<Result<ApplyStagedImportOutcome, StoreImportApplyError>> {
  return applyStagedImport({ batchId, client, home: store.home, nowIso, stopOnConflict });
}

/**
 * How many rows each table an apply writes holds, by table name.
 *
 * @returns each written table's row count
 */
export async function rowCounts({ client }: { client: StoreClient }): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of WRITTEN) {
    const [row] = await client.db.select({ rows: count() }).from(table);
    counts[getTableName(table)] = row!.rows;
  }
  return counts;
}

/**
 * The sum of every count.
 *
 * @returns the total rows across the tables counted
 */
export function totalRows({ counts }: { counts: Record<string, number> }): number {
  return Object.values(counts).reduce((sum, rows) => sum + rows, 0);
}

/**
 * One standing ask under a fixed quote, as a line of an export's standing-ask part.
 *
 * @param covers the surfaces the ask covers, which decide which live asks it meets
 * @returns the ask and its export line
 */
export function standingAsk({ id, covers }: { id: string; covers: readonly string[] }): {
  ask: StandingAsk;
  line: string;
} {
  const ask: StandingAsk = {
    covers,
    id,
    quote: {
      anchor: "talk:a0000017-0000-4000-8000-000000000019",
      atIso: "2026-10-04T00:55:00.000Z",
      cut: "none",
      where: "console-voice",
      words: "chuck anything worth a look on the board",
    },
    recordedAtIso: "2026-10-05T00:00:00.000Z",
  };
  return { ask, line: standingAskLine({ event: { kind: "recorded", ...ask } }) };
}
