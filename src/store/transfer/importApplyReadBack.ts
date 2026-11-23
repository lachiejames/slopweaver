/**
 * What an apply reads back inside its one transaction AFTER every write, its receipt the last of them: the store's
 * own read decided once more, which must write nothing, and every instruction written found in the state written
 * under the import question that admitted it. The reads before the writes are `./importApplyRead.ts`.
 */
import { getTableName, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreWriter } from "../client.js";
import { ownerCorrectionTable, ownerDirectiveTable } from "../schema/ownerJudgement.js";
import { standingAskTable } from "../schema/standingAsks.js";

import { readStoreContentsIn } from "./bundleWrite.js";
import { type ImportEffects, importApplicationEffects } from "./importApplyEffects.js";
import { type StoreImportApplyError, StoreImportApplyErrors } from "./importApplyErrors.js";
import type { ImportApplicationPlan } from "./importApplyPlan.js";
import { liveRetained } from "./liveRetained.js";
import { importRowStatuses } from "./rowClassify.js";

/**
 * How many rows a set of effects writes that the store's own read would show, a voice cohort counted as the one entry
 * it is. An instruction written inactive is left out: the store's read holds only what steers, so it never reads one
 * back, and `instructionsMissingIn` finds it instead.
 */
function readableEffectRows({ effects }: { effects: ImportEffects }): number {
  const { profile, directives, corrections, standingAsks, ...lists } = effects;
  const active = [...directives, ...corrections, ...standingAsks].filter((one) => one.state === "active").length;
  const listed = Object.values(lists).reduce((sum, list) => sum + list.length, active);
  return profile === null ? listed : listed + 1;
}

/** One instruction written: its own id, the import question that admitted it, and the state it was written in. */
type WrittenInstruction = {
  readonly id: string;
  readonly questionId: string;
  readonly state: string;
};

/**
 * How many of the instructions written into one register are not there as written: its own id, in the state written,
 * under the import question that admitted it — so a version swallowed while an identical one stands in for it, or two
 * versions' questions swapped, is missing.
 */
async function instructionsMissingIn({
  writer,
  table,
  idColumn,
  written,
}: {
  writer: StoreWriter;
  table: typeof ownerDirectiveTable | typeof ownerCorrectionTable | typeof standingAskTable;
  idColumn: "directive_id" | "correction_id" | "ask_id";
  written: readonly WrittenInstruction[];
}): Promise<number> {
  if (written.length === 0) {
    return 0;
  }
  const wanted = sql.join(
    written.map((one) => sql`${one.questionId}`),
    sql`, `,
  );
  const found = await writer.execute<WrittenInstruction>(
    sql`select ${sql.identifier(idColumn)} as id, import_question_id as "questionId", state::text as state from ${sql.identifier("public")}.${sql.identifier(getTableName(table))} where import_question_id in (${wanted})`,
  );
  const key = (one: WrittenInstruction): string => JSON.stringify([one.id, one.questionId, one.state]);
  const present = new Set(found.map(key));
  return written.filter((one) => !present.has(key(one))).length;
}

/**
 * `IMPORT_APPLICATION_FAILED` unless the store, read back inside the apply's transaction after its writes, holds every
 * IMPORTED row it wrote as decided: the batch decided once more over what the transaction now sees must write nothing
 * the store's read would show, and every instruction written, active or inactive (the read never shows an inactive
 * one), must be found under its own id, in the state written, under the import question that admitted it. An imported row a trigger, rule or policy dropped without an
 * error, or rewrote in a column the import compares, by the time of this read, refuses the batch; a change deferred to
 * commit comes after it. What is not read back: what the apply
 * derives beside them (a live row retired or withdrawn, a journal position, a revision), a column the store assigns
 * rather than the import (a row's id), and the content of an instruction written inactive.
 *
 * @param writer the apply's open transaction, after its writes
 * @param application the plan the writes were decided from
 * @param written the effects the writes performed
 * @returns `null` when every row reads back, else the refusal counting what did not read back as written
 */
export async function writtenAsDecided({
  writer,
  application,
  written,
}: {
  writer: StoreWriter;
  application: ImportApplicationPlan;
  written: ImportEffects;
}): Promise<Result<null, StoreImportApplyError>> {
  const batchId = application.staged.batch.id;
  const register = "the store read back";
  const instructionsMissing =
    (await instructionsMissingIn({
      idColumn: "directive_id",
      table: ownerDirectiveTable,
      writer,
      written: written.directives.map(({ value, questionId, state }) => ({ id: value.id, questionId, state })),
    })) +
    (await instructionsMissingIn({
      idColumn: "correction_id",
      table: ownerCorrectionTable,
      writer,
      written: written.corrections.map(({ value, questionId, state }) => ({ id: value.id, questionId, state })),
    })) +
    (await instructionsMissingIn({
      idColumn: "ask_id",
      table: standingAskTable,
      writer,
      written: written.standingAsks.map(({ ask, questionId, state }) => ({ id: ask.id, questionId, state })),
    }));
  if (instructionsMissing > 0) {
    const why = `${String(instructionsMissing)} instruction(s) it wrote are not in the store under their question in the state written: a trigger, rule or row policy outside the migrations dropped or changed them`;
    return err(StoreImportApplyErrors.applicationFailed({ batchId, register, why }));
  }
  const contents = await readStoreContentsIn({ reader: { db: writer } });
  const live = contents.andThen((value) => liveRetained({ contents: value }));
  if (live.isErr()) {
    return err(StoreImportApplyErrors.applicationFailed({ batchId, register, why: live.error.message }));
  }
  const statuses = importRowStatuses({ imported: application.staged.imported, live: live.value });
  if (statuses.isErr()) {
    return err(StoreImportApplyErrors.applicationFailed({ batchId, register, why: statuses.error.message }));
  }
  const again = importApplicationEffects({ application, statuses: statuses.value });
  if (again.isErr()) {
    return err(again.error);
  }
  const left = readableEffectRows({ effects: again.value });
  if (left > 0) {
    const why = `${String(left)} row(s) it wrote do not read back as written: a trigger, rule or row policy outside the migrations dropped or changed them`;
    return err(StoreImportApplyErrors.applicationFailed({ batchId, register, why }));
  }
  return ok(null);
}
