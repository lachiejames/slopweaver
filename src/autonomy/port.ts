/**
 * The one door every reader and writer of the autonomy ledger goes through — AGENTS.md rule 10's recording half.
 *
 * ## Where it lives: the store
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local Supabase store, and the home becomes deletable. The
 * `autonomy_event` table (`../store/schema/ledgers.ts`) is the ledger; `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl`
 * is only the source of the one-time import, `slopweaver store import-fleet --only autonomy`, and nothing here
 * reads it. A store that cannot be opened is `AUTONOMY_STORE_UNAVAILABLE`, and a store that has not imported a
 * register still standing in the home is `AUTONOMY_NOT_IMPORTED` — never an empty ledger, because "nothing was
 * done without asking" is exactly the confident wrong answer the Fleet Briefing is built to catch.
 *
 * ## Injection
 *
 * Only a composition root calls {@link autonomyLedgerPort}. A unit test, which may not mock, passes a plain
 * {@link AutonomyLedgerPort} value — `src/__tests__/autonomyLedgerFixture.ts` builds one over in-memory rows.
 */
import type { Result } from "#lib/result.js";

import type { AutonomyError } from "./errors.js";
import type { AutonomyStoreError } from "./storeErrors.js";
import { storeAutonomyLedgerPort } from "./storePort.js";
import { productionAutonomyStoreSeams } from "./storeRows.js";
import type { AutonomyAppendReceipt, AutonomyRecord } from "./types.js";

/**
 * The ledger's two operations, as one value a caller threads.
 *
 * A write is ONE insert attempt and is never retried. A second act under one id is decided by the database: the
 * same act is `appended: false`, a different one `ACTION_ID_CONFLICT`, so two sessions recording one id end with
 * exactly one act.
 */
export interface AutonomyLedgerPort {
  /** Every record, in the order it was written. */
  readonly readRecords: (request: {
    readonly home: string;
  }) => Promise<Result<readonly AutonomyRecord[], AutonomyStoreError>>;
  /** Validate one record and write it, exactly once. */
  readonly appendRecord: (request: {
    readonly home: string;
    readonly record: AutonomyRecord;
  }) => Promise<Result<AutonomyAppendReceipt, AutonomyError | AutonomyStoreError>>;
}

/**
 * The port this install's autonomy ledger is reached through: the store.
 *
 * @returns the port every production reader and writer uses
 */
export function autonomyLedgerPort(): AutonomyLedgerPort {
  return storeAutonomyLedgerPort({ seams: productionAutonomyStoreSeams() });
}
