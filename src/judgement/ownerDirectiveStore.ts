/**
 * The orchestration of the owner-judgement store over injected seams: run the one-time import, then read the
 * active versions or apply one memory event's transitions. Pure of I/O itself — every effect is a seam
 * (`./ownerDirectivePort.ts`), production's being `./ownerDirectiveRows.ts`.
 *
 * ## Three answers that must never be confused
 *
 * - **An empty authority** — the store holds no active version — is an empty overlay, and a turn runs with none.
 * - **An outage** — the store selected but unreachable, a row that will not decode, a marker over lost rows — is a
 *   refusal, and a turn brief refuses with it rather than answering against rulings it could not read.
 * - **No store selected** is read as nothing recorded ONLY when the home also holds no legacy file: there is then
 *   no directive anywhere this build could reach. A legacy file waiting to be imported, or a memory event that
 *   records a change, refuses with `OWNER_DIRECTIVE_STORE_UNSELECTED` instead, because answering empty there would
 *   drop a ruling that exists.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { MemoryLeaf } from "../memory/types.js";
import { ensureImported, overConnection, type StoreStepFailure } from "../store/registerImport.js";

import {
  type OwnerDirectiveError,
  OwnerDirectiveErrors,
  type OwnerDirectiveStoreUnselectedError,
} from "./ownerDirective.errors.js";
import type { OwnerDirectiveOverlay } from "./ownerDirective.js";
import type { OwnerDirectivePort, OwnerDirectiveStoreSeams, OwnerJudgementRows } from "./ownerDirectivePort.js";
import { changesFromMemory, noChanges, planMemorySync } from "./ownerJudgementPlan.js";
import {
  EMPTY_OWNER_DIRECTIVE_OVERLAY,
  type OwnerDirectiveChanges,
  type OwnerDirectiveSyncOutcome,
  overlayOfActiveRows,
} from "./ownerJudgementRecords.js";

/**
 * A store step that did not finish, in this domain's terms: a marker over lost rows is named with both counts,
 * anything else is an outage.
 *
 * @param doing what the step was for
 * @param reason what the driver said
 * @param markerInconsistency the two counts, when the step was trusting a marker over lost rows
 * @returns the typed error
 */
function ownerJudgementStepFailure({ doing, reason, markerInconsistency }: StoreStepFailure): OwnerDirectiveError {
  if (markerInconsistency !== undefined) {
    return OwnerDirectiveErrors.importMarkerInconsistent(markerInconsistency);
  }
  return OwnerDirectiveErrors.storeUnavailable({ doing, reason });
}

/**
 * Run the one-time import over an open connection.
 *
 * @param home whose legacy file is the import source
 * @param rows the open connection
 * @param seams where the file read comes from
 * @returns nothing once the tables are the whole register, or the refusal
 */
export async function ensureOwnerJudgementImported({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: Pick<OwnerJudgementRows, "claim" | "marker">;
  seams: Pick<OwnerDirectiveStoreSeams, "readHomeFile">;
}): Promise<Result<undefined, OwnerDirectiveError>> {
  return ensureImported({
    readSource: () => seams.readHomeFile({ home }),
    rows,
    unavailable: ownerJudgementStepFailure,
  });
}

/**
 * Read the active overlay over an open connection.
 *
 * @param home the Slopweaver home whose store and legacy file are meant
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the overlay, or the refusal
 */
async function readWith({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: OwnerJudgementRows;
  seams: OwnerDirectiveStoreSeams;
}): Promise<Result<OwnerDirectiveOverlay, OwnerDirectiveError>> {
  const ready = await ensureOwnerJudgementImported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  // The read re-counts the import's rows against its marker inside its own snapshot, so a row lost after the
  // import was checked refuses here rather than reading as a smaller authority.
  const stored = await rows.readStored();
  if (stored.isErr()) {
    return err(stored.error);
  }
  return overlayOfActiveRows({ stored: stored.value });
}

/**
 * Apply one memory event over an open connection: import first, so a write made before any read never strands
 * the legacy file's rulings behind tables that are no longer empty.
 *
 * @param home the Slopweaver home whose store and legacy file are meant
 * @param changes the event's validated changes
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the outcome, or the refusal
 */
async function syncWith({
  home,
  changes,
  rows,
  seams,
}: {
  home: string;
  changes: OwnerDirectiveChanges;
  rows: OwnerJudgementRows;
  seams: OwnerDirectiveStoreSeams;
}): Promise<Result<OwnerDirectiveSyncOutcome, OwnerDirectiveError>> {
  if (noChanges({ changes })) {
    const read = await readWith({ home, rows, seams });
    return read.map((overlay): OwnerDirectiveSyncOutcome => ({
      directiveCount: overlay.directives.length,
      kind: "unchanged",
    }));
  }
  const ready = await ensureOwnerJudgementImported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  return rows.transact({ plan: ({ stored }) => planMemorySync({ changes, stored }) });
}

/**
 * What a read answers when the home selects no store: nothing recorded, iff no legacy file waits to be imported.
 *
 * @param home the Slopweaver home
 * @param unselected the connect seam's refusal, carrying the store's own selection sentence
 * @param seams where the legacy read comes from
 * @returns the empty overlay, or the refusal
 */
function readUnselected({
  home,
  unselected,
  seams,
}: {
  home: string;
  unselected: OwnerDirectiveStoreUnselectedError;
  seams: OwnerDirectiveStoreSeams;
}): Result<OwnerDirectiveOverlay, OwnerDirectiveError> {
  const homeFile = seams.readHomeFile({ home });
  if (homeFile.isErr()) {
    return err(homeFile.error);
  }
  if (homeFile.value.state === "absent") {
    return ok(EMPTY_OWNER_DIRECTIVE_OVERLAY);
  }
  return err(
    OwnerDirectiveErrors.storeUnselected({
      needed: "wait in the legacy judgement/owner-directives.json to be imported",
      selection: unselected.selection,
    }),
  );
}

/**
 * An owner-directive port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./ownerDirectiveRows.ts`'s
 * @returns the port
 */
export function storeOwnerDirectivePort({ seams }: { seams: OwnerDirectiveStoreSeams }): OwnerDirectivePort {
  return {
    readActive: async ({ home }) => {
      const read = await overConnection({
        body: (rows) => readWith({ home, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: ownerJudgementStepFailure,
      });
      if (read.isOk()) {
        return read;
      }
      const failure = read.error;
      if (failure.code === "OWNER_DIRECTIVE_STORE_UNSELECTED") {
        return readUnselected({ home, seams, unselected: failure });
      }
      return err(failure);
    },
    syncFromMemory: async ({ home, leaves }) => syncFromMemoryWith({ home, leaves, seams }),
  };
}

/**
 * The port's write: validate the event, then apply it over a connection — or, with no store selected, answer
 * `unchanged` only for an event that changes nothing in a home with nothing to import.
 *
 * @param home the Slopweaver home
 * @param leaves the memory leaves the hook observed
 * @param seams the effects
 * @returns the outcome, or the refusal
 */
async function syncFromMemoryWith({
  home,
  leaves,
  seams,
}: {
  home: string;
  leaves: readonly MemoryLeaf[];
  seams: OwnerDirectiveStoreSeams;
}): Promise<Result<OwnerDirectiveSyncOutcome, OwnerDirectiveError>> {
  const changes = changesFromMemory({ leaves });
  if (changes.isErr()) {
    return err(changes.error);
  }
  const synced = await overConnection({
    body: (rows) => syncWith({ changes: changes.value, home, rows, seams }),
    connect: () => seams.connect({ home }),
    unavailable: ownerJudgementStepFailure,
  });
  if (synced.isOk()) {
    return synced;
  }
  const failure = synced.error;
  if (failure.code !== "OWNER_DIRECTIVE_STORE_UNSELECTED") {
    return err(failure);
  }
  if (!noChanges({ changes: changes.value })) {
    return err(
      OwnerDirectiveErrors.storeUnselected({ needed: "were recorded by a memory", selection: failure.selection }),
    );
  }
  return readUnselected({ home, seams, unselected: failure }).map((overlay): OwnerDirectiveSyncOutcome => ({
    directiveCount: overlay.directives.length,
    kind: "unchanged",
  }));
}
