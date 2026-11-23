/**
 * The one door the owner's standing asks are read and written through.
 *
 * The `standing_ask` tables are the authority (`../store/schema/standingAsks.ts`). The old
 * `judgement/standing-asks.jsonl` is imported ONCE, on the first operation of any connection, its sha256 and size
 * kept on the marker; every later operation checks the old path again and refuses a file that is no longer the
 * bytes imported, because an append made there by a build from before the move would otherwise be dropped. A
 * store that cannot be reached is a typed refusal, never an empty register: a card would read "no standing ask
 * covers this" over an ask that stands.
 *
 * Every effect arrives through {@link StandingAskStoreSeams}, so a unit test drives every branch over a plain
 * in-memory fake (`src/__tests__/standingAskFixture.ts` — a seam, not a mock). The orchestration is
 * `./standingAskStore.ts`; the Postgres half and the production seams are `./standingAskRows.ts`; what only a real
 * database can prove is the opt-in `src/__tests__/integration/standingAskStore.test.ts`.
 *
 * Only a composition root calls {@link standingAskPort}: `SLOPWEAVER_STORE_URL` overrides the home's own selection,
 * so a test that forgot to inject a port could otherwise reach a real store.
 *
 * A store export reaches the same register through {@link StandingAskTransferPort}, the same door over a connection
 * the export already holds, so its one `repeatable read` snapshot covers every part. The SQL stays in
 * `./standingAskRows.ts`; `../store/transfer/bundleWrite.ts` names none of it.
 */
import type { Result } from "#lib/result.js";

import type { StoreClient, StoreReader } from "../store/client.js";
import type { ImportOnceRows, ImportSourceWitness, MarkedSource, StoreStepFailure } from "../store/registerImport.js";

import type { StandingAskError } from "./standingAskErrors.js";
import type { ImportedStandingAskEvent, StandingAskHomeFileLine, StoredStandingAsks } from "./standingAskRecords.js";
import { productionStandingAskSeams, productionStandingAskTransferSeams } from "./standingAskRows.js";
import { storeStandingAskPort, storeStandingAskTransferPort } from "./standingAskStore.js";
import type { StandingAsk } from "./standingAsks.js";
import type { StandingAskRequest, StandingAskWrite, StandingAskWriteOutcome } from "./standingAskWrites.js";

/** The register's two operations, as one value a caller threads. */
export interface StandingAskPort {
  /** The asks standing now, in the order recorded; an empty register is an empty list, an outage a refusal. */
  readonly readActive: (request: {
    readonly home: string;
  }) => Promise<Result<readonly StandingAsk[], StandingAskError>>;
  /** Judge one add or withdrawal against the asks standing at that instant, and record it. */
  readonly write: (request: {
    readonly home: string;
    readonly request: StandingAskRequest;
  }) => Promise<Result<StandingAskWriteOutcome, StandingAskError>>;
}

/** The home journal as one read found it: nothing there, or its nonblank lines and the bytes they came from. */
export type StandingAskHomeFile =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly lines: readonly StandingAskHomeFileLine[];
      readonly witness: ImportSourceWitness;
    };

/** The row operations one open connection offers, and the handle that closes it. */
export interface StandingAskRows extends ImportOnceRows<ImportedStandingAskEvent> {
  /** What the marker recorded of the home file, or undefined when no import has run. */
  readonly markedSource: () => Promise<Result<MarkedSource | undefined, StoreStepFailure>>;
  /**
   * The active generations, their coverage and every event, read in one snapshot that counts the import's events
   * against its marker again — so an event lost after the import was checked is
   * `STANDING_ASK_IMPORT_MARKER_INCONSISTENT`, never a smaller register.
   */
  readonly readStored: () => Promise<Result<StoredStandingAsks, StandingAskError>>;
  /**
   * Take the register's write lock, read it with the same marker re-check, decide against it, and record what was
   * decided in that one transaction. A decision or a re-check that refuses writes nothing; a racing writer that
   * met an index first is `STANDING_ASK_WRITE_CONFLICT`.
   */
  readonly write: (request: {
    readonly decide: (request: { readonly stored: StoredStandingAsks }) => Result<StandingAskWrite, StandingAskError>;
  }) => Promise<Result<StandingAskWriteOutcome, StandingAskError>>;
  readonly close: () => Promise<void>;
}

/** Every effect the register performs. */
export interface StandingAskStoreSeams {
  /**
   * Open the store for one home: `STANDING_ASK_STORE_UNSELECTED` when the home selects none, and
   * `STANDING_ASK_STORE_UNAVAILABLE` when the selected one cannot be opened.
   */
  readonly connect: (request: { readonly home: string }) => Promise<Result<StandingAskRows, StandingAskError>>;
  /** The strict read of the home journal: for its import, and on every operation for its witness. */
  readonly readHomeFile: (request: { readonly home: string }) => Result<StandingAskHomeFile, StandingAskError>;
}

/**
 * The port this install's standing asks are reached through: the store. Composition roots only.
 *
 * @returns the port every production reader and writer uses
 */
export function standingAskPort(): StandingAskPort {
  return storeStandingAskPort({ seams: productionStandingAskSeams() });
}

/**
 * The register as an export carries it: every event's exact line, and the asks those lines fold to.
 *
 * @internal — named only by {@link StandingAskTransferPort}'s own contract.
 */
export interface StandingAskPortableJournal {
  /** Every event's exact line, in journal order — withdrawn generations' included. */
  readonly lines: readonly string[];
  /** The asks standing, once the fold of `lines` was checked against every stored row. */
  readonly active: readonly StandingAsk[];
}

/** The register's half of a store export, over a connection the export opened and closes. */
export interface StandingAskTransferPort {
  /**
   * The one-time import and the witness check, over the export's own connection and before its snapshot opens: a
   * journal never imported is imported, and one changed since its import refuses.
   */
  readonly ensureImported: (request: {
    readonly home: string;
    readonly client: StoreClient;
  }) => Promise<Result<undefined, StandingAskError>>;
  /**
   * Inside the caller's own snapshot: every event with the marker re-counted, its fold checked against the tables
   * before a line is handed back, so an export never carries a register that does not read as one.
   */
  readonly readPortableJournal: (request: {
    readonly reader: StoreReader;
  }) => Promise<Result<StandingAskPortableJournal, StandingAskError>>;
}

/** The effects a {@link StandingAskTransferPort} performs over a connection it is handed. */
export interface StandingAskTransferSeams extends Pick<StandingAskStoreSeams, "readHomeFile"> {
  /** The row operations over the export's open client; the export, never these, closes it. */
  readonly rowsOver: (request: { readonly client: StoreClient }) => StandingAskRows;
  /** The register through one reader, its import marker re-counted through the same one. */
  readonly readSnapshot: (request: {
    readonly reader: StoreReader;
  }) => Promise<Result<StoredStandingAsks, StandingAskError>>;
}

/**
 * The transfer port over the real tables and the real home journal. It opens no connection of its own — every
 * operation runs over the client or reader its caller passes — so any caller holding one may take it.
 *
 * @returns the port a store export reads the register through
 */
export function standingAskTransferPort(): StandingAskTransferPort {
  return storeStandingAskTransferPort({ seams: productionStandingAskTransferSeams() });
}
