/**
 * The wake journal's file, and the per-park claim every reseat holds across its `cmux spawn`.
 *
 * **An unreadable journal is a failure, never an empty one** — the same rule `../home/reclaim/journalStore.ts`
 * keeps: a journal read as empty tells the wake no reseat ever acted on anything, which licenses exactly the second
 * boot this file exists to prevent. A missing file is a fresh install. A line that will not decode fails the whole
 * read, naming the path and the line, because it may be the attempt for any row.
 *
 * **The claim is the operation lock's never-stale-while-alive lease** (`../admit/operationLock.ts`), one key per
 * park. `handover wake` runs its spawn through `spawnSync`, so the child cannot outlive the wake holding the claim: a
 * LIVE holder is mid-reseat and is never taken over, however long the boot, and a DEAD one is taken over at once.
 * An expiry guessed from the spawn budget was the alternative, and fails: a boot running past the guess
 * would be reseated beside itself.
 */
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";

import { acquireOperationLockDetailed } from "../admit/operationLock.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { decodeWakeJournalRow, type WakeJournalRow } from "./wakeJournal.js";

/** The journal exists and could not be read, or a line in it is not a row. */
interface WakeJournalUnreadableError {
  readonly code: "WAKE_JOURNAL_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A row could not be appended. */
interface WakeJournalUnwritableError {
  readonly code: "WAKE_JOURNAL_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** The per-park claim could not be taken for a reason no rerun is known to clear. */
interface WakeClaimRefusedError {
  readonly code: "WAKE_CLAIM_REFUSED";
  readonly message: string;
}

/** Why the wake journal or a park's claim could not be used. */
export type WakeJournalError = WakeJournalUnreadableError | WakeJournalUnwritableError | WakeClaimRefusedError;

/** The one place each {@link WakeJournalError} is built. */
const WakeJournalErrors = {
  claimRefused: ({ why }: { why: string }): WakeClaimRefusedError => ({
    code: "WAKE_CLAIM_REFUSED",
    message: `the park's wake claim was refused: ${why}`,
  }),
  unreadable: ({ path, why }: { path: string; why: string }): WakeJournalUnreadableError => ({
    code: "WAKE_JOURNAL_UNREADABLE",
    message: `the wake journal at ${path} did not read (${why}) — no park is reseated until it does, since any line may be a reseat already made`,
    path,
  }),
  unwritable: ({ cause, path }: { cause: unknown; path: string }): WakeJournalUnwritableError => ({
    code: "WAKE_JOURNAL_UNWRITABLE",
    message: `the wake journal at ${path} could not be appended to: ${String(cause)}`,
    path,
  }),
} as const;

/** Owner-only, like every other ledger. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Read every row, oldest first.
 *
 * @param home the state home
 * @returns the rows — none for a fresh install — or why the journal could not be trusted
 */
export function readWakeJournal({ home }: { home: string }): Result<readonly WakeJournalRow[], WakeJournalError> {
  const path = stateHomePaths({ home }).handoverWakeJournalJsonl;
  try {
    statSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok([]);
    }
    return err(WakeJournalErrors.unreadable({ path, why: String(error) }));
  }
  const rows: WakeJournalRow[] = [];
  let bad: string | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (bad !== undefined || line.trim().length === 0) {
          return;
        }
        let value: unknown;
        try {
          value = safeJsonParse({ label: "a wake journal row", text: line });
        } catch {
          bad = `line ${String(index + 1)} is not JSON`;
          return;
        }
        const row = decodeWakeJournalRow({ value });
        if (row.isErr()) {
          bad = `line ${String(index + 1)} is not a wake row: ${row.error.join("; ")}`;
          return;
        }
        rows.push(row.value);
      },
      path,
    });
  } catch (error: unknown) {
    return err(WakeJournalErrors.unreadable({ path, why: String(error) }));
  }
  if (bad !== undefined) {
    return err(WakeJournalErrors.unreadable({ path, why: bad }));
  }
  return ok(rows);
}

/**
 * Append one row durably — fsynced with its directory before returning, since an attempt must outlive a crash in
 * the spawn that follows it.
 *
 * @param home the state home
 * @returns ok, or why the append failed
 */
export function appendWakeJournalRow({
  home,
  row,
}: {
  home: string;
  row: WakeJournalRow;
}): Result<void, WakeJournalError> {
  const path = stateHomePaths({ home }).handoverWakeJournalJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({
      durable: true,
      mode: FILE_MODE,
      path,
      text: safeJsonStringify({ label: "a wake journal row", value: row }),
    });
  } catch (error: unknown) {
    return err(WakeJournalErrors.unwritable({ cause: error, path }));
  }
  return ok(undefined);
}

/** A park's claim: held, to be released, or held by a live wake already reseating that park. */
export type WakeParkClaim =
  { readonly kind: "claimed"; readonly release: () => void } | { readonly kind: "in-flight"; readonly reason: string };

/**
 * Take the claim on one park for the length of its reseat.
 *
 * @param nowIso the instant the claim records
 * @param parkIndex the park's position in its run journal
 * @param parkedAtIso the park's own instant
 * @returns the claim, a live holder's reason, or why the claim was refused
 */
export function claimWakePark({
  home,
  nowIso,
  parkIndex,
  parkedAtIso,
  slug,
}: {
  home: string;
  nowIso: string;
  slug: string;
  parkIndex: number;
  parkedAtIso: string;
}): Result<WakeParkClaim, WakeJournalError> {
  const lock = acquireOperationLockDetailed({
    home,
    key: `handover-wake:${slug}:${String(parkIndex)}:${parkedAtIso}`,
    nowIso,
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isOk()) {
    return ok({ kind: "claimed", release: lock.value.release });
  }
  if (lock.error.code === "LOCK_CONTENDED") {
    return ok({ kind: "in-flight", reason: lock.error.message });
  }
  return err(WakeJournalErrors.claimRefused({ why: lock.error.message }));
}
