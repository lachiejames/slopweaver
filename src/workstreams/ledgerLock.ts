/**
 * The one mutex the workstreams ledgers share — reactions, definitions, titles, proposals and who-first — so a caller
 * that decides from a ledger whether to write decides and writes in one critical section.
 *
 * The register itself needs no lock of this kind: the store's own transactions and revisions guard every register
 * write (`./store/port.ts`). This key is deliberately not the register's: the retired register's tombstone fence takes
 * that one on every store open (`./store/retiredRegister.ts`), so a ledger section holding it while it opens the store
 * would wait on itself.
 */
import { err, type Result } from "#lib/result.js";
import { acquireOperationLock } from "../admit/operationLock.js";
import { resolveHome } from "../cli/optionParsers.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";

/** The operation-lock key every ledger write takes. */
export const LEDGER_LOCK_KEY = "workstreams-ledgers";

/**
 * Run `run` holding the ledger lock, released however `run` ends.
 *
 * @param home the state home, the resolved one when absent
 * @param nowIso the lock's clock
 * @param run the critical section, handed the resolved home
 * @returns what `run` returned, or that another writer holds the ledgers
 */
export async function underLedgerLock<T, E>({
  home,
  nowIso,
  run,
}: {
  home?: string | undefined;
  nowIso: string;
  run: (held: { locked: string }) => Promise<Result<T, E>>;
}): Promise<Result<T, E | CandidatesError>> {
  const resolvedHome = resolveHome({ named: home });
  const lock = acquireOperationLock({ home: resolvedHome, key: LEDGER_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(CandidatesErrors.registerBusy({ why: lock.error }));
  }
  try {
    return await run({ locked: resolvedHome });
  } finally {
    lock.value.release();
  }
}
