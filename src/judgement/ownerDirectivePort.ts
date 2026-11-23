/**
 * The one door the owner's directives and corrections are read and written through.
 *
 * The `owner_directive` and `owner_correction` tables are the authority (`../store/schema/ownerJudgement.ts`).
 * The legacy `judgement/owner-directives.json` is imported ONCE, on the first operation of any connection, and
 * never read again. A store that cannot be reached is a typed refusal, never an empty overlay: a turn brief that
 * read an outage as "no directives" would answer against rulings the owner already made.
 *
 * Every effect arrives through {@link OwnerDirectiveStoreSeams}, so a unit test drives every branch over a plain
 * in-memory fake (`src/__tests__/ownerJudgementFixture.ts` — a seam, not a mock). The orchestration is
 * `./ownerDirectiveStore.ts`; the Postgres half and the production seams are `./ownerDirectiveRows.ts`; what only
 * a real database can prove is the opt-in `src/__tests__/integration/ownerJudgementStore.test.ts`.
 *
 * Only a composition root calls {@link ownerDirectivePort}: `SLOPWEAVER_STORE_URL` overrides the home's own
 * selection, so a test that forgot to inject a port could otherwise reach a real store.
 */
import type { Result } from "#lib/result.js";

import type { MemoryLeaf } from "../memory/types.js";
import type { ImportOnceRows, ImportSource } from "../store/registerImport.js";

import type { OwnerDirectiveError } from "./ownerDirective.errors.js";
import type { OwnerDirectiveOverlay } from "./ownerDirective.js";
import { productionOwnerDirectiveSeams } from "./ownerDirectiveRows.js";
import { storeOwnerDirectivePort } from "./ownerDirectiveStore.js";
import type {
  OwnerDirectiveSyncOutcome,
  OwnerJudgementRecord,
  OwnerJudgementTransition,
  StoredOwnerJudgement,
} from "./ownerJudgementRecords.js";

/** The register's two operations, as one value a caller threads. */
export interface OwnerDirectivePort {
  /** The overlay the ACTIVE versions project to; an empty authority is an empty overlay, an outage a refusal. */
  readonly readActive: (request: {
    readonly home: string;
  }) => Promise<Result<OwnerDirectiveOverlay, OwnerDirectiveError>>;
  /** Apply one memory-hook event's explicit directives, corrections and revocations. */
  readonly syncFromMemory: (request: {
    readonly home: string;
    readonly leaves: readonly MemoryLeaf[];
  }) => Promise<Result<OwnerDirectiveSyncOutcome, OwnerDirectiveError>>;
}

/**
 * What a writing transaction's plan answers: the transitions to apply, and the outcome the write reports.
 *
 * @internal
 */
export interface OwnerJudgementPlan {
  readonly transition: OwnerJudgementTransition;
  readonly answer: OwnerDirectiveSyncOutcome;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface OwnerJudgementRows extends ImportOnceRows<OwnerJudgementRecord> {
  /**
   * Every ACTIVE version in both tables, read in one snapshot that counts the import's rows against its marker
   * again — so a row lost after the import was checked is `OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT`, never a
   * smaller authority.
   */
  readonly readStored: () => Promise<Result<StoredOwnerJudgement, OwnerDirectiveError>>;
  /**
   * Read the active versions inside one transaction, with the same marker re-check, plan against them, and apply
   * the plan's transitions in that transaction. A plan or a re-check that refuses writes nothing; a racing
   * activation is `OWNER_DIRECTIVE_WRITE_CONFLICT`.
   */
  readonly transact: (request: {
    readonly plan: (request: {
      readonly stored: StoredOwnerJudgement;
    }) => Result<OwnerJudgementPlan, OwnerDirectiveError>;
  }) => Promise<Result<OwnerDirectiveSyncOutcome, OwnerDirectiveError>>;
  readonly close: () => Promise<void>;
}

/** Every effect the register performs. */
export interface OwnerDirectiveStoreSeams {
  /**
   * Open the store for one home: `OWNER_DIRECTIVE_STORE_UNSELECTED` when the home selects none, and
   * `OWNER_DIRECTIVE_STORE_UNAVAILABLE` when the selected one cannot be opened.
   */
  readonly connect: (request: { readonly home: string }) => Promise<Result<OwnerJudgementRows, OwnerDirectiveError>>;
  /** The strict read of the home file, consulted only when no import marker exists or no store is selected. */
  readonly readHomeFile: (request: {
    readonly home: string;
  }) => Result<ImportSource<OwnerJudgementRecord>, OwnerDirectiveError>;
}

/**
 * The port this install's owner judgement is reached through: the store. Composition roots only.
 *
 * @returns the port every production reader and writer uses
 */
export function ownerDirectivePort(): OwnerDirectivePort {
  return storeOwnerDirectivePort({ seams: productionOwnerDirectiveSeams() });
}
