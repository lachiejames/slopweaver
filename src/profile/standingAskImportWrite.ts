/**
 * Writing an applied store import's standing asks inside the caller's transaction — the SQL half of
 * `./standingAskImportRows.ts`.
 *
 * The caller holds the apply transaction and has taken `STANDING_ASKS_WRITE_LOCK` (`./standingAskRows.ts`) before
 * anything was read, the same lock every `profile standing` write takes first, so the register read here is the one
 * the rows are judged against. Withdrawals run before any insert so neither the one-active-generation index nor the
 * one-active-coverage index ever sees the replaced ask and its replacement at once.
 */
import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreWriter } from "../store/client.js";
import { standingAskCoverageTable, standingAskEventTable, standingAskTable } from "../store/schema/standingAsks.js";

import { type StandingAskError, StandingAskErrors } from "./standingAskErrors.js";
import {
  contradictoryStandingAskVersion,
  type ImportedStandingAskVersion,
  standingAskImportRows,
} from "./standingAskImportRows.js";
import { readStandingAskSnapshot } from "./standingAskRows.js";
import { isStandingAskWriteRace } from "./standingAskWrites.js";

/** The refusal a thrown statement becomes: a unique index met is a race, anything else the store's. */
function writeFailure({ cause }: { cause: unknown }): StandingAskError {
  const reason = cause instanceof Error ? cause.message : "unknown failure";
  if (isStandingAskWriteRace({ cause })) {
    return StandingAskErrors.writeConflict({ reason });
  }
  return StandingAskErrors.storeUnavailable({ doing: "write the imported standing asks", reason });
}

/**
 * Write an applied import's standing asks through the caller's transaction.
 *
 * @param writer the apply transaction, already holding the standing-ask lock
 * @param versions the imported asks, each with the state and replacements its answer gave it
 * @param withdrawnAtIso the instant every replacement withdrawal records
 * @returns how many rows were written, cascaded coverage included, or the register's refusal — a version withdrawing
 *   live asks while written inactive refused before any statement, the read included
 */
export async function writeImportedStandingAsks({
  writer,
  versions,
  withdrawnAtIso,
}: {
  writer: StoreWriter;
  versions: readonly ImportedStandingAskVersion[];
  withdrawnAtIso: string;
}): Promise<Result<number, StandingAskError>> {
  const contradiction = contradictoryStandingAskVersion({ versions });
  if (contradiction !== undefined) {
    return err(contradiction);
  }
  try {
    const stored = await readStandingAskSnapshot({ reader: { db: writer } });
    if (stored.isErr()) {
      return err(stored.error);
    }
    const rows = standingAskImportRows({ mintId: randomUUID, stored: stored.value, versions, withdrawnAtIso });
    if (rows.isErr()) {
      return err(rows.error);
    }
    const { asks, coverage, events, withdrawRowIds, writes } = rows.value;
    if (withdrawRowIds.length > 0) {
      const withdrawn = await writer
        .update(standingAskTable)
        .set({ state: "withdrawn" })
        .where(and(inArray(standingAskTable.rowId, [...withdrawRowIds]), eq(standingAskTable.state, "active")))
        .returning({ rowId: standingAskTable.rowId });
      if (withdrawn.length !== withdrawRowIds.length) {
        return err(StandingAskErrors.writeConflict({ reason: "a replaced ask stopped standing mid-import" }));
      }
    }
    if (asks.length > 0) {
      await writer.insert(standingAskTable).values([...asks]);
    }
    if (coverage.length > 0) {
      await writer.insert(standingAskCoverageTable).values([...coverage]);
    }
    if (events.length > 0) {
      await writer.insert(standingAskEventTable).values([...events]);
    }
    return ok(writes);
  } catch (cause) {
    return err(writeFailure({ cause }));
  }
}
