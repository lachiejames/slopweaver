/**
 * Appending an applied store import's steer measurements inside the caller's transaction.
 *
 * The register is append-only, its UPDATE and DELETE refused by triggers that are always enabled, so an import never
 * rewrites a measurement: a new one keeps the event id and line its source minted and takes the next local
 * `journal_seq`, and a differing one under an id already held is an alignment question that never reaches here. Every
 * row is `store-import`, and each is checked against its own id before it is written, by the same re-derivation every
 * read applies (`./steerMeasurementRecords.ts`'s `steerImportedRowRefusal`), so a row a later read would refuse is
 * never stored.
 *
 * The caller holds the apply transaction and has taken `STEER_MEASUREMENTS_WRITE_LOCK` (`./steerMeasurementRows.ts`)
 * before reading the highest sequence here, as every append does.
 */
import { max } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreWriter } from "../store/client.js";
import { steerMeasurementTable } from "../store/schema/steerMeasurements.js";

import { type SteerMeasurementError, SteerMeasurementErrors } from "./steerMeasurementErrors.js";
import {
  nextSteerJournalSeq,
  type SteerMeasurementInsertRow,
  steerImportedRowRefusal,
} from "./steerMeasurementRecords.js";
import { isSteerAppendRace } from "./steerMeasurementRows.js";
import type { SteerMeasurementEnvelopeV2 } from "./steerMeasurementTransfer.js";

/**
 * The rows an import appends, numbered on from the highest sequence held. Pure.
 *
 * @param measurements the imported envelopes, in the order the export carried them
 * @param highest the highest `journal_seq` the register holds, null when it is empty
 * @returns the rows, or `STEER_IMPORTED_ROW_ALTERED` for one whose id its own line and place do not mint
 */
export function importedSteerAppendRows({
  measurements,
  highest,
}: {
  measurements: readonly SteerMeasurementEnvelopeV2[];
  highest: number | null;
}): Result<readonly SteerMeasurementInsertRow[], SteerMeasurementError> {
  const first = nextSteerJournalSeq({ highest });
  const rows = measurements.map((envelope, at): SteerMeasurementInsertRow => ({
    eventId: envelope.eventId,
    exactLine: envelope.exactText,
    journalSeq: first + at,
    origin: "store-import",
    sourceOrdinal: envelope.sourceOrdinal,
  }));
  const refused = steerImportedRowRefusal({ measurements: rows });
  if (refused !== undefined) {
    return err(refused);
  }
  return ok(rows);
}

/**
 * Append an applied import's steer measurements through the caller's transaction.
 *
 * @param writer the apply transaction, already holding the steer-measurement lock
 * @param measurements the imported envelopes, each new to this register
 * @returns how many rows were appended, or the refusal: a row its id does not name, a sequence or id already held
 *   (`STEER_APPEND_CONFLICT`), or the store's own failure
 */
export async function appendImportedSteerMeasurements({
  writer,
  measurements,
}: {
  writer: StoreWriter;
  measurements: readonly SteerMeasurementEnvelopeV2[];
}): Promise<Result<number, SteerMeasurementError>> {
  if (measurements.length === 0) {
    return ok(0);
  }
  try {
    const [top] = await writer.select({ highest: max(steerMeasurementTable.journalSeq) }).from(steerMeasurementTable);
    // An aggregate with no GROUP BY always answers exactly one row.
    const rows = importedSteerAppendRows({ highest: top!.highest, measurements });
    if (rows.isErr()) {
      return err(rows.error);
    }
    await writer.insert(steerMeasurementTable).values([...rows.value]);
    return ok(rows.value.length);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown failure";
    if (isSteerAppendRace({ cause })) {
      return err(SteerMeasurementErrors.appendConflict({ reason }));
    }
    return err(SteerMeasurementErrors.storeUnavailable({ doing: "append the imported steer measurements", reason }));
  }
}
