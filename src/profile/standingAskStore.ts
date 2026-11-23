/**
 * The orchestration of the standing-ask store over injected seams: run the one-time import of the home journal,
 * check the old path still holds exactly what was imported, then read the asks standing or record one write. Pure
 * of I/O itself — every effect is a seam (`./standingAskPort.ts`), production's being `./standingAskRows.ts`.
 *
 * ## Three answers that must never be confused
 *
 * - **An empty register** — the store holds no active ask — is an empty list, and every card reads as covered by
 *   none.
 * - **An outage** — the store selected but unreachable, a row the journal's fold disagrees with, a marker over lost
 *   events, a home journal changed after its import — is a refusal, and the console draws it as a defect on every
 *   card it would have quoted.
 * - **No store selected** reads as nothing recorded ONLY when the home holds no journal either: there is then no
 *   standing ask anywhere this build could reach. A journal waiting to be imported refuses with
 *   `STANDING_ASK_STORE_UNSELECTED`, and so does every write.
 */
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { overConnection } from "../store/registerImport.js";
import { ensureWitnessedImport } from "../store/witnessedJournal.js";

import { type StandingAskError, StandingAskErrors, type StandingAskStoreUnselectedError } from "./standingAskErrors.js";
import { standingAskImportSource } from "./standingAskImport.js";
import type {
  StandingAskPort,
  StandingAskRows,
  StandingAskStoreSeams,
  StandingAskTransferPort,
  StandingAskTransferSeams,
} from "./standingAskPort.js";
import { activeStandingAsksOf } from "./standingAskProjection.js";
import { standingAskExportLines } from "./standingAskRecords.js";
import type { StandingAsk } from "./standingAsks.js";
import {
  planStandingAskWrite,
  type StandingAskRequest,
  type StandingAskWriteOutcome,
  standingAskStepFailure,
} from "./standingAskWrites.js";

/**
 * Make the store the whole register over an open connection: the one-time import, then the witness check — the
 * old path is gone, or still exactly the bytes imported. Anything else refuses, because an append made there after
 * the import would otherwise never be seen.
 *
 * @param home whose journal is the import source
 * @param rows the open connection
 * @param seams where the journal read comes from
 * @returns nothing once the tables are the whole register, or the refusal
 */
async function ensureStandingAsksImported({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: Pick<StandingAskRows, "claim" | "marker" | "markedSource">;
  seams: Pick<StandingAskStoreSeams, "readHomeFile">;
}): Promise<Result<undefined, StandingAskError>> {
  return ensureWitnessedImport({
    changed: () => StandingAskErrors.homeFileChanged({ path: stateHomePaths({ home }).judgement.standingAsksJsonl }),
    markerGone: () =>
      StandingAskErrors.storeUnavailable({
        doing: "read the standing-ask import marker",
        reason: "the marker the import wrote is gone",
      }),
    readJournal: () => seams.readHomeFile({ home }),
    rows,
    toSource: (file) => standingAskImportSource({ file }),
    unavailable: standingAskStepFailure,
  });
}

/**
 * Read the asks standing over an open connection.
 *
 * @param home the Slopweaver home whose store and journal are meant
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the active asks, or the refusal
 */
async function readWith({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: StandingAskRows;
  seams: StandingAskStoreSeams;
}): Promise<Result<readonly StandingAsk[], StandingAskError>> {
  const ready = await ensureStandingAsksImported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const stored = await rows.readStored();
  if (stored.isErr()) {
    return err(stored.error);
  }
  return activeStandingAsksOf({ stored: stored.value });
}

/**
 * Record one write over an open connection: import first, so a write made before any read never strands the
 * journal's asks behind tables that are no longer empty; then decide against the register as the write lock
 * holds it.
 *
 * @param home the Slopweaver home whose store and journal are meant
 * @param request what was asked for
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the outcome, or the refusal
 */
async function writeWith({
  home,
  request,
  rows,
  seams,
}: {
  home: string;
  request: StandingAskRequest;
  rows: StandingAskRows;
  seams: StandingAskStoreSeams;
}): Promise<Result<StandingAskWriteOutcome, StandingAskError>> {
  const ready = await ensureStandingAsksImported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  return rows.write({
    decide: ({ stored }) =>
      activeStandingAsksOf({ stored }).andThen((active) => planStandingAskWrite({ active, request })),
  });
}

/**
 * What a read answers when the home selects no store: nothing recorded, iff no journal waits to be imported.
 *
 * @param home the Slopweaver home
 * @param unselected the connect seam's refusal, carrying the store's own selection sentence
 * @param seams where the journal read comes from
 * @returns the empty list, or the refusal
 */
function readUnselected({
  home,
  unselected,
  seams,
}: {
  home: string;
  unselected: StandingAskStoreUnselectedError;
  seams: StandingAskStoreSeams;
}): Result<readonly StandingAsk[], StandingAskError> {
  const homeFile = seams.readHomeFile({ home });
  if (homeFile.isErr()) {
    return err(homeFile.error);
  }
  if (homeFile.value.state === "absent") {
    return ok([]);
  }
  return err(
    StandingAskErrors.storeUnselected({
      needed: "wait in judgement/standing-asks.jsonl to be imported",
      selection: unselected.selection,
    }),
  );
}

/**
 * A standing-ask port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./standingAskRows.ts`'s
 * @returns the port
 */
export function storeStandingAskPort({ seams }: { seams: StandingAskStoreSeams }): StandingAskPort {
  return {
    readActive: async ({ home }) => {
      const read = await overConnection({
        body: (rows) => readWith({ home, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: standingAskStepFailure,
      });
      if (read.isOk() || read.error.code !== "STANDING_ASK_STORE_UNSELECTED") {
        return read;
      }
      return readUnselected({ home, seams, unselected: read.error });
    },
    write: async ({ home, request }) => {
      const written = await overConnection({
        body: (rows) => writeWith({ home, request, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: standingAskStepFailure,
      });
      if (written.isOk() || written.error.code !== "STANDING_ASK_STORE_UNSELECTED") {
        return written;
      }
      return err(
        StandingAskErrors.storeUnselected({ needed: "are recorded in the store", selection: written.error.selection }),
      );
    },
  };
}

/**
 * The register's half of a store export, over whichever seams it is handed: the import and witness check over the
 * export's connection, then a read inside the export's snapshot whose fold is checked before any line leaves.
 *
 * @param seams the effects — production's are `./standingAskRows.ts`'s
 * @returns the transfer port
 */
export function storeStandingAskTransferPort({ seams }: { seams: StandingAskTransferSeams }): StandingAskTransferPort {
  return {
    ensureImported: ({ home, client }) => ensureStandingAsksImported({ home, rows: seams.rowsOver({ client }), seams }),
    readPortableJournal: async ({ reader }) => {
      const stored = await seams.readSnapshot({ reader });
      if (stored.isErr()) {
        return err(stored.error);
      }
      return activeStandingAsksOf({ stored: stored.value }).map((active) => ({
        active,
        lines: standingAskExportLines({ events: stored.value.events }),
      }));
    },
  };
}
