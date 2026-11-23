/**
 * Gathering a store export: every part of the installation's owned state, read at one moment. Writing it
 * out, whole or not at all, is `bundlePublish.ts`.
 *
 * The store parts are read in ONE `read only`, `repeatable read` transaction, so the register, its recall
 * ledger, the owner rows and the owner's active directives and corrections describe a single snapshot. The
 * owner-judgement register's one-time import of its legacy file runs first, over the same connection, so a
 * home whose file was never imported exports what it held, and the snapshot then counts the import's rows against
 * its marker again, so a row lost between the two refuses the export instead of shrinking it. The standing asks
 * take the same path, through their own port (`../../profile/standingAskPort.ts`'s transfer half): their journal's
 * one-time import and witness check run first, and the snapshot reads every
 * event's exact line, folds them, and checks the fold against the tables before a line is exported. The steer
 * measurements take the same path through theirs (`../../profile/steerMeasurementPort.ts`): import and witness
 * first, then one v2 envelope per stored measurement (`../../profile/steerMeasurementTransfer.ts`), inside the same
 * snapshot. No part is read from the home any more; the two
 * witnessed journals' checks run again AFTER the snapshot, so an old build appending to one while the snapshot was
 * open refuses the export rather than being exported around; `store export` runs them once more after publishing
 * and removes the directory it published on a refusal (`../../cli/commands/store/transferRun.ts`).
 */
import { eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { readHomeFileOwnerJudgement } from "../../judgement/ownerDirectiveImport.js";
import { ownerJudgementRowsOver, readOwnerJudgementSnapshot } from "../../judgement/ownerDirectiveRows.js";
import { ensureOwnerJudgementImported } from "../../judgement/ownerDirectiveStore.js";
import { overlayOfActiveRows, type StoredOwnerJudgement } from "../../judgement/ownerJudgementRecords.js";
import { exportedMemoryLine, exportedRecallLine } from "../../knowledge/exportLines.js";
import { readAllMemories, readAllRecalls } from "../../knowledge/memoryStore.js";
import { standingAskTransferPort } from "../../profile/standingAskPort.js";
import { steerMeasurementTransferPort } from "../../profile/steerMeasurementPort.js";
import type { StoreClient, StoreReader } from "../client.js";
import { readVoiceRegister } from "../profile/client.js";
import type { VoiceCohort } from "../profile/types.js";
import type { MemoryRecordingRow } from "../schema/memories.js";
import type { MemoryRecallRow } from "../schema/memoryRecalls.js";
import { OWNER_PROFILE_ID, ownerProfileTable } from "../schema/ownerProfile.js";

import type { StoreExportContents } from "./bundlePublish.js";
import type { PortableOwnerProfile } from "./decode.js";
import { type StoreTransferError, StoreTransferErrors } from "./errors.js";

/** What an owner-judgement refusal reads as in an export: the part could not be read, by its own sentence. */
const OWNER_JUDGEMENT_PART = "the owner directives and corrections";

/** What a standing-ask refusal reads as in an export. */
const STANDING_ASKS_PART = "the standing asks";

/** The standing-ask register's door for an export: it opens nothing, every operation runs over the export's client. */
const STANDING_ASKS = standingAskTransferPort();

/** What a steer-measurement refusal reads as in an export. */
const STEER_MEASUREMENTS_PART = "the steer measurements";

/** The steer-measurement register's door for an export, over the export's client like the standing asks'. */
const STEER_MEASUREMENTS = steerMeasurementTransferPort();

/** The store's half of one export, read inside one snapshot. */
interface StoreSnapshot {
  readonly memories: readonly MemoryRecordingRow[];
  readonly recalls: readonly MemoryRecallRow[];
  readonly owner: PortableOwnerProfile | null;
  readonly voice: readonly VoiceCohort[];
  /** The active owner directive and correction versions — the export's directives part. */
  readonly ownerJudgement: StoredOwnerJudgement;
  /** Every standing-ask event's exact line in journal order, its fold already checked against the tables. */
  readonly standingAskLines: readonly string[];
  /** Every steer measurement's exact line in journal order, its import marker re-counted. */
  readonly steerLines: readonly string[];
}

/** The owner row's portable half, or `null` on a store that never wrote one. */
async function readPortableOwner({ reader }: { reader: StoreReader }): Promise<PortableOwnerProfile | null> {
  const rows = await reader.db
    .select({
      displayName: ownerProfileTable.displayName,
      judgementProfile: ownerProfileTable.judgementProfile,
      selfDescription: ownerProfileTable.selfDescription,
    })
    .from(ownerProfileTable)
    .where(eq(ownerProfileTable.id, OWNER_PROFILE_ID))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return { displayName: row.displayName, judgementProfile: row.judgementProfile, selfDescription: row.selfDescription };
}

/** Every store part, read through the caller's reader, whose transaction decides the moment it describes. */
async function snapshotIn({ reader }: { reader: StoreReader }): Promise<Result<StoreSnapshot, StoreTransferError>> {
  const memories = await readAllMemories({ client: reader });
  if (memories.isErr()) {
    return err(StoreTransferErrors.sourceUnreadable({ cause: memories.error.message, what: "the knowledge register" }));
  }
  const recalls = await readAllRecalls({ client: reader });
  if (recalls.isErr()) {
    return err(StoreTransferErrors.sourceUnreadable({ cause: recalls.error.message, what: "the recall ledger" }));
  }
  const voice = await readVoiceRegister({ client: reader });
  if (voice.isErr()) {
    return err(StoreTransferErrors.sourceUnreadable({ cause: voice.error.message, what: "the voice register" }));
  }
  const owner = await readPortableOwner({ reader });
  const ownerJudgement = await readOwnerJudgementSnapshot({ reader });
  if (ownerJudgement.isErr()) {
    return err(
      StoreTransferErrors.sourceUnreadable({ cause: ownerJudgement.error.message, what: OWNER_JUDGEMENT_PART }),
    );
  }
  // The fold is checked against the tables before a line leaves: an export of a register that does not read as
  // one would be restored somewhere as one that does.
  const standingAsks = await STANDING_ASKS.readPortableJournal({ reader });
  if (standingAsks.isErr()) {
    return err(StoreTransferErrors.sourceUnreadable({ cause: standingAsks.error.message, what: STANDING_ASKS_PART }));
  }
  const steers = await STEER_MEASUREMENTS.readPortableLines({ reader });
  if (steers.isErr()) {
    return err(StoreTransferErrors.sourceUnreadable({ cause: steers.error.message, what: STEER_MEASUREMENTS_PART }));
  }
  return ok({
    memories: memories.value,
    owner,
    ownerJudgement: ownerJudgement.value,
    recalls: recalls.value,
    standingAskLines: standingAsks.value.lines,
    steerLines: steers.value,
    voice: voice.value,
  });
}

/** Every store part, inside one read-only snapshot. */
async function readSnapshot({ client }: { client: StoreClient }): Promise<Result<StoreSnapshot, StoreTransferError>> {
  try {
    return await client.db.transaction(async (tx) => snapshotIn({ reader: { db: tx } }), {
      accessMode: "read only",
      isolationLevel: "repeatable read",
    });
  } catch (cause) {
    return err(StoreTransferErrors.sourceUnreadable({ cause, what: "the store" }));
  }
}

/** A snapshot shaped as the export of it would hold it. */
function contentsOf({ snapshot }: { snapshot: StoreSnapshot }): Result<StoreExportContents, StoreTransferError> {
  const overlay = overlayOfActiveRows({ stored: snapshot.ownerJudgement }).mapErr((error) =>
    StoreTransferErrors.sourceUnreadable({ cause: error.message, what: OWNER_JUDGEMENT_PART }),
  );
  if (overlay.isErr()) {
    return err(overlay.error);
  }
  const { memories, recalls, owner, voice, standingAskLines, steerLines } = snapshot;
  return ok({
    directives: overlay.value,
    memoryLines: memories.map((row) => exportedMemoryLine({ row })),
    owner,
    recallLines: recalls.map((row) => exportedRecallLine({ row })),
    standingAskLines,
    steerMeasurementLines: steerLines,
    voiceLines: voice.map((cohort) => JSON.stringify(cohort)),
  });
}

/**
 * Every part's content as the live store holds it, read through the caller's transaction — an apply's, which holds
 * the tables locked, so what it compares is what it then writes over.
 *
 * @param reader the caller's open transaction
 * @returns every part's content, or why one could not be read
 */
export async function readStoreContentsIn({
  reader,
}: {
  reader: StoreReader;
}): Promise<Result<StoreExportContents, StoreTransferError>> {
  const snapshot = await snapshotIn({ reader });
  return snapshot.andThen((value) => contentsOf({ snapshot: value }));
}

/**
 * Every register's one-time import of its legacy home file, and both witnessed journals' witness check, over the
 * caller's connection: what an export runs before its snapshot, and an apply before its transaction.
 *
 * @param home the installation home whose legacy files are the import sources
 * @param client an open store connection, which this never closes
 * @returns nothing once every register is whole, or the first refusal
 */
export async function ensureRegistersImported({
  home,
  client,
}: {
  home: string;
  client: StoreClient;
}): Promise<Result<undefined, StoreTransferError>> {
  const ready = await ensureOwnerJudgement({ client, home });
  if (ready.isErr()) {
    return ready;
  }
  return ensureWitnessedRegisters({ client, home });
}

/**
 * Run the owner-judgement register's one-time import over the export's own connection, so a home whose legacy
 * file was never imported exports what that file held rather than an empty part.
 *
 * @param home the installation home whose legacy file is the import source
 * @param client the export's open connection, which this never closes
 * @returns nothing once the tables are the whole register, or the refusal
 */
async function ensureOwnerJudgement({
  home,
  client,
}: {
  home: string;
  client: StoreClient;
}): Promise<Result<undefined, StoreTransferError>> {
  const imported = await ensureOwnerJudgementImported({
    home,
    rows: ownerJudgementRowsOver({ client }),
    seams: { readHomeFile: readHomeFileOwnerJudgement },
  });
  return imported.mapErr((error) =>
    StoreTransferErrors.sourceUnreadable({ cause: error.message, what: OWNER_JUDGEMENT_PART }),
  );
}

/**
 * Run the standing-ask register's one-time import and witness check over the export's own connection, so a home
 * whose journal was never imported exports what it held, and one whose journal changed after its import refuses.
 *
 * @param home the installation home whose journal is the import source
 * @param client the export's open connection, which this never closes
 * @returns nothing once the tables are the whole register, or the refusal
 */
async function ensureStandingAsks({
  home,
  client,
}: {
  home: string;
  client: StoreClient;
}): Promise<Result<undefined, StoreTransferError>> {
  const imported = await STANDING_ASKS.ensureImported({ client, home });
  return imported.mapErr((error) =>
    StoreTransferErrors.sourceUnreadable({ cause: error.message, what: STANDING_ASKS_PART }),
  );
}

/**
 * Run the steer-measurement register's one-time import and witness check over the export's own connection.
 *
 * @param home the installation home whose journal is the import source
 * @param client the export's open connection, which this never closes
 * @returns nothing once the table is the whole register, or the refusal
 */
async function ensureSteerMeasurements({
  home,
  client,
}: {
  home: string;
  client: StoreClient;
}): Promise<Result<undefined, StoreTransferError>> {
  const imported = await STEER_MEASUREMENTS.ensureImported({ client, home });
  return imported.mapErr((error) =>
    StoreTransferErrors.sourceUnreadable({ cause: error.message, what: STEER_MEASUREMENTS_PART }),
  );
}

/**
 * Both witnessed journals' import and witness check: the standing asks', then the steer measurements'. The export
 * runs it before its snapshot, after it, and once more after the directory is published, so an old build's append
 * landing before that last check reads the file's end refuses the export rather than being left out of it. The
 * residue, stated: an append landing after that read, even before the verb exits, is in no export and the next read
 * or write refuses the changed journal — any last check has a moment after it.
 *
 * @param home the installation home whose journals are the import sources
 * @param client the export's open connection, which this never closes
 * @returns nothing once both registers are whole, or the first refusal
 */
export async function ensureWitnessedRegisters({
  home,
  client,
}: {
  home: string;
  client: StoreClient;
}): Promise<Result<undefined, StoreTransferError>> {
  const asks = await ensureStandingAsks({ client, home });
  if (asks.isErr()) {
    return asks;
  }
  return ensureSteerMeasurements({ client, home });
}

/**
 * Gather every part's content, every one of them from the store, in one snapshot.
 *
 * @param home the installation home whose old judgement files are imported once, if they never were
 * @param client an open store connection
 * @returns every part's content, or why it could not be read at one moment
 */
export async function readStoreExportContents({
  home,
  client,
}: {
  home: string;
  client: StoreClient;
}): Promise<Result<StoreExportContents, StoreTransferError>> {
  const ready = await ensureRegistersImported({ client, home });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const snapshot = await readSnapshot({ client });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  // The witness check again, AFTER the snapshot: an older build appending to a journal while the snapshot was open
  // would otherwise be exported around. Anything written after this is the next read's refusal.
  const journalsStill = await ensureWitnessedRegisters({ client, home });
  if (journalsStill.isErr()) {
    return err(journalsStill.error);
  }
  return contentsOf({ snapshot: snapshot.value });
}
