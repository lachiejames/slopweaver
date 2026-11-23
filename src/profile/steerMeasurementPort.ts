/**
 * The one door the owner's steer measurements are read and appended through.
 *
 * The `steer_measurement` table is the authority (`../store/schema/steerMeasurements.ts`). The old
 * `judgement/steer-kinds.jsonl` is imported ONCE, on the first operation of any connection, its sha256 and size kept
 * on the marker; every later operation checks the old path again and refuses a file that is no longer the bytes
 * imported, because an append made there by a build from before the move would otherwise be dropped. A store that
 * cannot be reached is a typed refusal, never an empty history: the Alignment page would read "nothing judged" over
 * a register that holds the owner's reads.
 *
 * Every effect arrives through {@link SteerMeasurementStoreSeams}, so a unit test drives every branch over a plain
 * in-memory fake (`src/__tests__/steerMeasurementFixture.ts` — a seam, not a mock). The orchestration is
 * `./steerMeasurementStore.ts`; the Postgres half and the production seams are `./steerMeasurementRows.ts`; what only
 * a real database can prove is the opt-in `src/__tests__/integration/steerMeasurementStore.test.ts`.
 *
 * Only a composition root calls {@link steerMeasurementPort}: `SLOPWEAVER_STORE_URL` overrides the home's own
 * selection, so a test that forgot to inject a port could otherwise reach a real store.
 *
 * A store export reaches the same register through {@link SteerMeasurementTransferPort}, over the connection the
 * export already holds, so its one `repeatable read` snapshot covers every part.
 */
import type { Result } from "#lib/result.js";

import type { StoreClient, StoreReader } from "../store/client.js";
import type { ImportOnceRows, MarkedSource, StoreStepFailure } from "../store/registerImport.js";
import type { WitnessedJournal } from "../store/witnessedJournal.js";

import type { SteerHistory, SteerVerdict } from "./steerKinds.js";
import type { SteerMeasurementError } from "./steerMeasurementErrors.js";
import type { ImportedSteerMeasurement, StoredSteerMeasurement } from "./steerMeasurementRecords.js";
import { productionSteerMeasurementSeams, productionSteerMeasurementTransferSeams } from "./steerMeasurementRows.js";
import { storeSteerMeasurementPort, storeSteerMeasurementTransferPort } from "./steerMeasurementStore.js";

/** What an append reports once its transaction committed. */
export interface SteerAppendOutcome {
  readonly kind: "written";
  readonly eventId: string;
  readonly journalSeq: number;
}

/** The register's two operations, as one value a caller threads. */
export interface SteerMeasurementPort {
  /** Every verdict that reads, in journal order, and the sequence of every stored line that does not. */
  readonly readHistory: (request: { readonly home: string }) => Promise<Result<SteerHistory, SteerMeasurementError>>;
  /** Append one judged verdict. */
  readonly append: (request: {
    readonly home: string;
    readonly verdict: SteerVerdict;
  }) => Promise<Result<SteerAppendOutcome, SteerMeasurementError>>;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface SteerMeasurementRows extends ImportOnceRows<ImportedSteerMeasurement> {
  /** What the marker recorded of the home file, or undefined when no import has run. */
  readonly markedSource: () => Promise<Result<MarkedSource | undefined, StoreStepFailure>>;
  /**
   * Every stored measurement in `journal_seq` order, read in one snapshot that counts the import's lines against its
   * marker again — so a line lost after the import was checked is `STEER_IMPORT_MARKER_INCONSISTENT`, never a
   * shorter history.
   */
  readonly readStored: () => Promise<Result<readonly StoredSteerMeasurement[], SteerMeasurementError>>;
  /**
   * Take the register's write lock, then append the verdict at one past the highest sequence, in that one
   * transaction. A racing appender that met the sequence index first is `STEER_APPEND_CONFLICT`.
   */
  readonly append: (request: {
    readonly verdict: SteerVerdict;
  }) => Promise<Result<SteerAppendOutcome, SteerMeasurementError>>;
  readonly close: () => Promise<void>;
}

/** Every effect the register performs. */
export interface SteerMeasurementStoreSeams {
  /**
   * Open the store for one home: `STEER_STORE_UNSELECTED` when the home selects none, and `STEER_STORE_UNAVAILABLE`
   * when the selected one cannot be opened.
   */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<SteerMeasurementRows, SteerMeasurementError>>;
  /** The strict read of the home journal: for its import, and on every operation for its witness. */
  readonly readHomeFile: (request: { readonly home: string }) => Result<WitnessedJournal, SteerMeasurementError>;
}

/**
 * The port this install's steer measurements are reached through: the store. Composition roots only.
 *
 * @returns the port every production reader and writer uses
 */
export function steerMeasurementPort(): SteerMeasurementPort {
  return storeSteerMeasurementPort({ seams: productionSteerMeasurementSeams() });
}

/** The register's half of a store export, over a connection the export opened and closes. */
export interface SteerMeasurementTransferPort {
  /**
   * The one-time import and the witness check, over the export's own connection and before its snapshot opens: a
   * journal never imported is imported, and one changed since its import refuses.
   */
  readonly ensureImported: (request: {
    readonly home: string;
    readonly client: StoreClient;
  }) => Promise<Result<undefined, SteerMeasurementError>>;
  /**
   * Inside the caller's own snapshot: one v2 envelope line per stored measurement, in journal order, the marker
   * re-counted first (`./steerMeasurementTransfer.ts`).
   */
  readonly readPortableLines: (request: {
    readonly reader: StoreReader;
  }) => Promise<Result<readonly string[], SteerMeasurementError>>;
}

/** The effects a {@link SteerMeasurementTransferPort} performs over a connection it is handed. */
export interface SteerMeasurementTransferSeams extends Pick<SteerMeasurementStoreSeams, "readHomeFile"> {
  /** The row operations over the export's open client; the export, never these, closes it. */
  readonly rowsOver: (request: { readonly client: StoreClient }) => SteerMeasurementRows;
  /** Every stored measurement through one reader, its import marker re-counted through the same one. */
  readonly readSnapshot: (request: {
    readonly reader: StoreReader;
  }) => Promise<Result<readonly StoredSteerMeasurement[], SteerMeasurementError>>;
}

/**
 * The transfer port over the real table and the real home journal. It opens no connection of its own.
 *
 * @returns the port a store export reads the register through
 */
export function steerMeasurementTransferPort(): SteerMeasurementTransferPort {
  return storeSteerMeasurementTransferPort({ seams: productionSteerMeasurementTransferSeams() });
}
