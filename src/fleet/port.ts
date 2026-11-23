/**
 * The one door every reader and writer of the fleet's state goes through: the capacity setting, the recovery
 * journal and the cmux revive journal.
 *
 * ## Where it lives: the store
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local store, and the home becomes deletable. {@link fleetPort} answers the store-backed port (`./storePort.ts`): the `fleet_config` row and the
 * `fleet_journal_event` rows are the authority, the legacy files under `$SLOPWEAVER_HOME/fleet/` are imported from
 * once, and nothing is projected back to a file — no reader of one remains. A store that cannot be reached is
 * `STORE_UNAVAILABLE`, never a file read.
 *
 * The recovery and revive LOCKS are not here: they are process-lifetime exclusion, so they live in the runtime
 * directory (`./locks.ts`), not the store.
 *
 * ## Injection
 *
 * Every consumer takes this port as a REQUIRED value, and only a composition root calls {@link fleetPort} — so a unit
 * test that forgot its seam fails to compile rather than reaching an ambient store. A test passes the in-memory port
 * `src/__tests__/fleetStoreFixture.ts` builds: a seam, not a mock (`.claude/rules/testing.md`).
 */
import type { Result } from "#lib/result.js";

import type { CmuxReviveEvent, CmuxReviveRead } from "../cmux/reviveJournal.js";
import type { FleetConfig } from "./config.js";
import type { FleetError } from "./errors.js";
import type { FleetJournalEvent, FleetJournalRead } from "./journal.js";
import { storeFleetPort } from "./storePort.js";
import { productionFleetStoreSeams } from "./storeRows.js";

/** The fleet's state operations, as one value a caller threads. */
export interface FleetPort {
  /** The capacity setting: the row, else a one-time import of the legacy file, else the default. */
  readonly readConfig: (request: { readonly home: string }) => Promise<Result<FleetConfig, FleetError>>;
  /** Replace the capacity setting by compare-and-set against the revision just read; a conflict is never retried. */
  readonly writeConfig: (request: {
    readonly config: FleetConfig;
    readonly home: string;
  }) => Promise<Result<FleetConfig, FleetError>>;
  /** Append to the recovery journal, answering the sequence it was stored under. */
  readonly appendResumeEvent: (request: {
    readonly event: FleetJournalEvent;
    readonly home: string;
  }) => Promise<Result<number, FleetError>>;
  /** The recovery journal's newest entries, oldest first. */
  readonly readResumeJournal: (request: { readonly home: string }) => Promise<Result<FleetJournalRead, FleetError>>;
  /** Append to the cmux revive journal, answering the sequence it was stored under. */
  readonly appendCmuxReviveEvent: (request: {
    readonly event: CmuxReviveEvent;
    readonly home: string;
  }) => Promise<Result<number, FleetError>>;
  /** The cmux revive journal's newest entries, oldest first. */
  readonly readCmuxReviveJournal: (request: { readonly home: string }) => Promise<Result<CmuxReviveRead, FleetError>>;
  /**
   * The revive journal's newest sequence — 0 before anything was journalled. Every committed append moves it by
   * exactly one, so two reads that differ mean something was journalled between them, whatever any clock said.
   */
  readonly newestCmuxReviveSequence: (request: { readonly home: string }) => Promise<Result<number, FleetError>>;
}

/**
 * The port this install's fleet state is reached through: the store. Called only at a composition root.
 *
 * @returns the port every production reader and writer uses
 */
export function fleetPort(): FleetPort {
  return storeFleetPort({ seams: productionFleetStoreSeams() });
}
