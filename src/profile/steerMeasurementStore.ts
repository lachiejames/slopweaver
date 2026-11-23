/**
 * The orchestration of the steer-measurement store over injected seams: run the one-time import of the home journal,
 * check the old path still holds exactly what was imported, then read the history or append one verdict. Pure of
 * I/O itself — every effect is a seam (`./steerMeasurementPort.ts`), production's being `./steerMeasurementRows.ts`.
 *
 * ## Three answers that must never be confused
 *
 * - **An empty register** — the store holds no measurement — is an empty history, and every cued turn reads unread.
 * - **An outage** — the store selected but unreachable, a marker over lost lines, a home journal changed after its
 *   import — is a refusal, and `profile steers` exits non-zero rather than printing an empty reading.
 * - **No store selected** reads as nothing judged ONLY when the home holds no journal either: there is then no
 *   measurement anywhere this build could reach. A journal waiting to be imported refuses with
 *   `STEER_STORE_UNSELECTED`, and so does every append.
 */
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { overConnection } from "../store/registerImport.js";
import { ensureWitnessedImport } from "../store/witnessedJournal.js";

import type { SteerHistory } from "./steerKinds.js";
import {
  type SteerMeasurementError,
  SteerMeasurementErrors,
  type SteerStoreUnselectedError,
} from "./steerMeasurementErrors.js";
import type {
  SteerMeasurementPort,
  SteerMeasurementRows,
  SteerMeasurementStoreSeams,
  SteerMeasurementTransferPort,
  SteerMeasurementTransferSeams,
} from "./steerMeasurementPort.js";
import { steerHistoryOf, steerMeasurementImportSource, steerStepFailure } from "./steerMeasurementRecords.js";
import { steerExportLines } from "./steerMeasurementTransfer.js";

/**
 * Make the store the whole register over an open connection: the one-time import, then the witness check.
 *
 * @param home whose journal is the import source
 * @param rows the open connection
 * @param seams where the journal read comes from
 * @returns nothing once the table is the whole register, or the refusal
 */
async function ensureSteersImported({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: Pick<SteerMeasurementRows, "claim" | "marker" | "markedSource">;
  seams: Pick<SteerMeasurementStoreSeams, "readHomeFile">;
}): Promise<Result<undefined, SteerMeasurementError>> {
  return ensureWitnessedImport({
    changed: () => SteerMeasurementErrors.homeFileChanged({ path: stateHomePaths({ home }).judgement.steerKindsJsonl }),
    markerGone: () =>
      SteerMeasurementErrors.storeUnavailable({
        doing: "read the steer-measurement import marker",
        reason: "the marker the import wrote is gone",
      }),
    readJournal: () => seams.readHomeFile({ home }),
    rows,
    toSource: (file) => ok(steerMeasurementImportSource({ file })),
    unavailable: steerStepFailure,
  });
}

/**
 * Read the history over an open connection, with the witness check on both sides of the read: an old build
 * appending to the journal between the first check and the read refuses this reading rather than being read around.
 * The residue, stated: an append after the second check reads the file is not in this reading, and
 * the next read or write refuses the changed journal — any last check has a moment after it.
 *
 * @param home the Slopweaver home whose store and journal are meant
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the history, or the refusal
 */
async function readWith({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: SteerMeasurementRows;
  seams: SteerMeasurementStoreSeams;
}): Promise<Result<SteerHistory, SteerMeasurementError>> {
  const ready = await ensureSteersImported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const stored = await rows.readStored();
  if (stored.isErr()) {
    return err(stored.error);
  }
  const still = await ensureSteersImported({ home, rows, seams });
  if (still.isErr()) {
    return err(still.error);
  }
  return ok(steerHistoryOf({ measurements: stored.value }));
}

/**
 * What a read answers when the home selects no store: nothing judged, iff no journal waits to be imported.
 *
 * @param home the Slopweaver home
 * @param unselected the connect seam's refusal, carrying the store's own selection sentence
 * @param seams where the journal read comes from
 * @returns the empty history, or the refusal
 */
function readUnselected({
  home,
  unselected,
  seams,
}: {
  home: string;
  unselected: SteerStoreUnselectedError;
  seams: SteerMeasurementStoreSeams;
}): Result<SteerHistory, SteerMeasurementError> {
  const homeFile = seams.readHomeFile({ home });
  if (homeFile.isErr()) {
    return err(homeFile.error);
  }
  if (homeFile.value.state === "absent") {
    return ok({ unparsed: [], verdicts: [] });
  }
  return err(
    SteerMeasurementErrors.storeUnselected({
      needed: "wait in judgement/steer-kinds.jsonl to be imported",
      selection: unselected.selection,
    }),
  );
}

/**
 * A steer-measurement port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./steerMeasurementRows.ts`'s
 * @returns the port
 */
export function storeSteerMeasurementPort({ seams }: { seams: SteerMeasurementStoreSeams }): SteerMeasurementPort {
  return {
    append: async ({ home, verdict }) => {
      const written = await overConnection({
        body: async (rows) => {
          // Import first, so an append made before any read never strands the journal behind a table that is no
          // longer empty.
          const ready = await ensureSteersImported({ home, rows, seams });
          if (ready.isErr()) {
            return err(ready.error);
          }
          return rows.append({ verdict });
        },
        connect: () => seams.connect({ home }),
        unavailable: steerStepFailure,
      });
      if (written.isOk() || written.error.code !== "STEER_STORE_UNSELECTED") {
        return written;
      }
      return err(
        SteerMeasurementErrors.storeUnselected({
          needed: "are recorded in the store",
          selection: written.error.selection,
        }),
      );
    },
    readHistory: async ({ home }) => {
      const read = await overConnection({
        body: (rows) => readWith({ home, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: steerStepFailure,
      });
      if (read.isOk() || read.error.code !== "STEER_STORE_UNSELECTED") {
        return read;
      }
      return readUnselected({ home, seams, unselected: read.error });
    },
  };
}

/**
 * The register's half of a store export, over whichever seams it is handed: the import and witness check over the
 * export's connection, then a read inside the export's snapshot.
 *
 * @param seams the effects — production's are `./steerMeasurementRows.ts`'s
 * @returns the transfer port
 */
export function storeSteerMeasurementTransferPort({
  seams,
}: {
  seams: SteerMeasurementTransferSeams;
}): SteerMeasurementTransferPort {
  return {
    ensureImported: ({ home, client }) => ensureSteersImported({ home, rows: seams.rowsOver({ client }), seams }),
    readPortableLines: async ({ reader }) => {
      const stored = await seams.readSnapshot({ reader });
      return stored.map((measurements) => steerExportLines({ measurements }));
    },
  };
}
