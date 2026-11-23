/**
 * The filesystem edge of corpus propagation: one record per sync, the one active batch, and each retired batch.
 *
 * Layout under `stateHomePaths(...).live.recipe.propagationDir`:
 *
 * - `records/<propagationId>.json` — what one sync re-derived. Written once; a repeat write of the same id is the
 *   same sync, so it is simply replaced with identical content.
 * - `batch.json` — the one open judgement pass. Absent means no pass is open.
 * - `batches/<batchId>.json` — a pass that confirmed everything it covered, moved off `batch.json`.
 *
 * Every write is atomic. The read-modify-write of `batch.json` is serialised by the caller under one operation
 * lock (`cli/commands/automation/propagateRun.ts`); this module never locks, so a unit test drives it on a temp dir.
 */
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import {
  type PropagationBatch,
  type PropagationRecord,
  parsePropagationBatch,
  parsePropagationRecord,
} from "./propagationBatch.js";
import { type PropagationError, PropagationErrors } from "./propagationErrors.js";

/** The active batch's file name. */
const BATCH_FILE = "batch.json";

/**
 * Write one sync's propagation record.
 *
 * @param dir the propagation directory
 * @param record what the sync re-derived
 * @returns the path written, or why it could not be
 */
export function writePropagationRecord({
  dir,
  record,
}: {
  readonly dir: string;
  readonly record: PropagationRecord;
}): Result<string, PropagationError> {
  const path = join(dir, "records", `${record.propagationId}.json`);
  try {
    mkdirSync(join(dir, "records"), { recursive: true });
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: `propagation ${record.propagationId}`, value: record })}\n`,
      path,
    });
  } catch (cause) {
    return err(PropagationErrors.recordWriteFailed({ cause, path, recipeId: record.recipeId }));
  }
  return ok(path);
}

/**
 * Read one sync's propagation record.
 *
 * @param dir the propagation directory
 * @param propagationId the record's id
 * @returns the record, or why it could not be read
 */
export function readPropagationRecord({
  dir,
  propagationId,
}: {
  readonly dir: string;
  readonly propagationId: string;
}): Result<PropagationRecord, PropagationError> {
  const path = join(dir, "records", `${propagationId}.json`);
  let value: unknown;
  try {
    value = safeJsonParse({ label: `propagation ${propagationId}`, text: readFileSync(path, "utf8") });
  } catch (cause) {
    return err(PropagationErrors.fileUnreadable({ cause, path }));
  }
  return parsePropagationRecord({ value }).mapErr((reasons) => PropagationErrors.fileInvalid({ path, reasons }));
}

/**
 * Read the active batch.
 *
 * Absent is `null`, a real answer. A file that is there and will not parse is an ERROR, never `null`: reading a
 * corrupt batch as "no pass open" would seat a second pass over the first one's syncs.
 *
 * @param dir the propagation directory
 * @returns the open batch, `null` when none is open, or why the file could not be read
 */
export function readActiveBatch({ dir }: { readonly dir: string }): Result<PropagationBatch | null, PropagationError> {
  const path = join(dir, BATCH_FILE);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok(null);
    }
    return err(PropagationErrors.fileUnreadable({ cause, path }));
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "propagation batch", text });
  } catch (cause) {
    return err(PropagationErrors.fileInvalid({ path, reasons: [`not JSON: ${errorMessage({ error: cause })}`] }));
  }
  return parsePropagationBatch({ value }).mapErr((reasons) => PropagationErrors.fileInvalid({ path, reasons }));
}

/**
 * Write the active batch.
 *
 * @param dir the propagation directory
 * @param batch the batch to write
 * @returns null, or why it could not be written
 */
export function writeActiveBatch({
  dir,
  batch,
}: {
  readonly dir: string;
  readonly batch: PropagationBatch;
}): Result<null, PropagationError> {
  const path = join(dir, BATCH_FILE);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "propagation batch", value: batch })}\n`,
      path,
    });
  } catch (cause) {
    return err(PropagationErrors.batchWriteFailed({ cause, path }));
  }
  return ok(null);
}

/**
 * Retire the active batch: write its final state, then move it to `batches/<batchId>.json`.
 *
 * @param dir the propagation directory
 * @param batch the batch in its final, fully confirmed state
 * @returns the retired path, or why it could not be retired
 */
export function retireActiveBatch({
  dir,
  batch,
}: {
  readonly dir: string;
  readonly batch: PropagationBatch;
}): Result<string, PropagationError> {
  const written = writeActiveBatch({ batch, dir });
  if (written.isErr()) {
    return err(written.error);
  }
  const retired = join(dir, "batches", `${batch.batchId}.json`);
  try {
    mkdirSync(join(dir, "batches"), { recursive: true });
    renameSync(join(dir, BATCH_FILE), retired);
  } catch (cause) {
    return err(PropagationErrors.batchRetireFailed({ cause, path: retired }));
  }
  return ok(retired);
}
