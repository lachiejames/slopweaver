/**
 * The one door every reader and writer of the door's audit trail goes through.
 *
 * ## Where it lives: the store
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local Supabase store, and the home becomes deletable. The
 * `door_event` table (`../store/schema/ledgers.ts`) is the audit trail; `$SLOPWEAVER_HOME/ledgers/door.jsonl` is
 * only the source of the one-time import, `slopweaver store import-fleet --only door`, and nothing here reads it.
 * A store that cannot be opened is `DOOR_STORE_UNAVAILABLE`, never a file fallback: `throughDoor` records BEFORE it
 * performs, so an outage refuses the effect rather than performing it unaudited.
 *
 * ## Injection
 *
 * Only a composition root calls {@link doorLedgerPort}. A unit test, which may not mock, passes a plain
 * {@link DoorLedgerPort} value — `src/__tests__/doorLedgerFixture.ts` builds one over in-memory rows.
 */
import type { Result } from "#lib/result.js";

import type { PreDoorRefusalEntry } from "./doorRefusalRead.js";
import type { DoorStoreError } from "./doorStoreErrors.js";
import { storeDoorLedgerPort } from "./doorStorePort.js";
import { productionDoorStoreSeams } from "./doorStoreRows.js";
import type { PreDoorRefusal } from "./ledger.js";
import type { DoorDecision, DoorRequest } from "./types.js";

/** One held or overridden decision, as the reflect pass reads it: the fields it folds on, nothing else. */
export interface DoorFrictionEntry {
  readonly action: string;
  readonly status: string;
  readonly overridden: readonly string[];
  readonly tsIso: string;
}

/**
 * The ledger's four operations, as one value a caller threads.
 *
 * A write is ONE insert attempt and is never retried: a collision is `DOOR_WRITE_KEY_TAKEN`, an outage
 * `DOOR_STORE_UNAVAILABLE`.
 */
export interface DoorLedgerPort {
  /** Record one door decision, exactly once. */
  readonly appendDecision: (request: {
    readonly home: string;
    readonly decision: DoorDecision;
    readonly doorRequest: DoorRequest;
    readonly runId: string;
    readonly tsIso: string;
  }) => Promise<Result<undefined, DoorStoreError>>;
  /** Record one send a pre-door gate refused, exactly once. */
  readonly appendPreDoorRefusal: (request: {
    readonly home: string;
    readonly refusal: PreDoorRefusal;
  }) => Promise<Result<undefined, DoorStoreError>>;
  /** The newest `limit` pre-door refusals, oldest first. */
  readonly readRecentPreDoorRefusals: (request: {
    readonly home: string;
    readonly limit: number;
  }) => Promise<Result<readonly PreDoorRefusalEntry[], DoorStoreError>>;
  /** Every ATTRIBUTED hold or override in `[fromIso, toIso]`, in written order. */
  readonly readDoorFriction: (request: {
    readonly home: string;
    readonly fromIso: string;
    readonly toIso: string;
  }) => Promise<Result<readonly DoorFrictionEntry[], DoorStoreError>>;
}

/**
 * The port this install's door ledger is reached through: the store.
 *
 * @returns the port every production reader and writer uses
 */
export function doorLedgerPort(): DoorLedgerPort {
  return storeDoorLedgerPort({ seams: productionDoorStoreSeams() });
}
