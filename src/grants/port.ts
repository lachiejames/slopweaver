/**
 * The one door every reader and writer of the journalled-grant record goes through
 * (`.claude/rules/journalled-grants.md`).
 *
 * ## Where it lives: the store
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local Supabase store, and the home becomes deletable. The
 * `grant_row` table (`../store/schema/ledgers.ts`) is the journal; `$SLOPWEAVER_HOME/grants/journal.jsonl` is only
 * the source of the one-time import, `slopweaver store import-fleet --only grants`, and nothing here reads it. A
 * store that cannot be opened is `GRANT_STORE_UNAVAILABLE`, never an empty journal: an empty read would turn every
 * row into `ROW_MISSING`, and a write with nowhere to go would be a grant nobody recorded.
 *
 * ## Injection
 *
 * Only a composition root calls {@link grantJournalPort}. A unit test, which may not mock, passes a plain
 * {@link GrantJournalPort} value — `src/__tests__/grantJournalFixture.ts` builds one over in-memory rows.
 */
import type { Result } from "#lib/result.js";

import type { GrantEntry } from "./grant.js";
import type { GrantStoreError } from "./storeErrors.js";
import { storeGrantJournalPort } from "./storePort.js";
import { productionGrantStoreSeams } from "./storeRows.js";

/**
 * The journal's two operations, as one value a caller threads.
 *
 * A write is ONE insert attempt and is never retried. A second grant under one id is `GRANT_ID_TAKEN`, a second
 * performance of one grant `GRANT_ALREADY_PERFORMED` — the database decides both, so two performers that each read
 * "not yet performed" end with exactly one performance.
 */
export interface GrantJournalPort {
  /** Every entry, in the order it was written. */
  readonly readEntries: (request: { readonly home: string }) => Promise<Result<readonly GrantEntry[], GrantStoreError>>;
  /** Write one entry, exactly once. */
  readonly appendEntry: (request: {
    readonly home: string;
    readonly entry: GrantEntry;
  }) => Promise<Result<undefined, GrantStoreError>>;
}

/**
 * The port this install's grant journal is reached through: the store.
 *
 * @returns the port every production reader and writer uses
 */
export function grantJournalPort(): GrantJournalPort {
  return storeGrantJournalPort({ seams: productionGrantStoreSeams() });
}
