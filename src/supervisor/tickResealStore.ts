/**
 * `supervisor tick-reseal`'s edge: the preview that writes nothing, and the apply that rewrites the tick ledger
 * with every stale `stats` recomputed (`./tickReseal.ts` is the pure row half, `./tickResealPass.ts` the streamed
 * pass both run).
 *
 * ## Streamed both ways
 *
 * The ledger has no ceiling (`./tickStore.ts` § The read is STREAMED), so the pass reads it through
 * `readJsonlDescriptorLines` and writes through `writeFileAtomicStream`, hashing the very bytes its lines were
 * decoded from. No row but the one in hand is ever held.
 *
 * ## What the apply guarantees, in order
 *
 * Under the tick ledger's lock (`withTickLedgerLock`, the one the append takes too): the ledger is copied to an
 * exclusive owner-only backup, the pass reads THAT copy, and refuses unless it hashes to the digest the preview
 * printed. The rewrite is staged beside the ledger and read back through the ordinary reader,
 * `visitSupervisorTicks`, BEFORE it is installed — so a rewrite that would not read clean never replaces the
 * ledger. The live ledger is hashed once more just before the rename, because a seat on an older checkout appends
 * without this lock; the residue is the instant between that hash and the rename. Every refusal before the rename
 * removes the backup and the staging file, leaving the home exactly as it was.
 */
import { chmodSync, constants, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { fsyncFile, renameStagedFile, writeFileAtomicStream } from "../lib/writeAtomic.js";
import { supervisorCoreErrorLines } from "./errors.js";
import { visitSupervisorTicks } from "./tickLedgerCheck.js";
import { type TickResealError, TickResealErrors } from "./tickResealErrors.js";
import { type PassOutcome, passRefusal, resealPass, sha256OfFile } from "./tickResealPass.js";
import { supervisorLedgerDir, supervisorTickLedgerPath, withTickLedgerLock } from "./tickStore.js";

/** Owner-only: the ledger, its backup and the receipt journal all carry the owner's words or point at them. */
const FILE_MODE = 0o600;

/** What a preview found: the digest an apply must name, and how many rows it would rewrite. */
export interface TickResealPlan {
  readonly path: string;
  /** sha256 of the whole ledger's bytes, as read. */
  readonly sourceSha256: string;
  /** Rows read, blank lines aside. */
  readonly rowsRead: number;
  /** Rows whose recorded stats disagree with their content, which an apply rewrites. */
  readonly rowsChanged: number;
  /** Rows whose re-render with their RECORDED stats is their exact source line. */
  readonly rowsRenderedAsRead: number;
}

/** One apply, as its receipt journals it. */
export interface TickResealReceipt {
  readonly resealedAtIso: string;
  readonly reason: string;
  readonly ledgerPath: string;
  readonly sourceSha256: string;
  readonly resultSha256: string;
  readonly backupPath: string;
  readonly rowsRead: number;
  readonly rowsChanged: number;
}

/** What a successful apply returns: the receipt and the journal it was appended to. */
interface AppliedReseal {
  readonly receipt: TickResealReceipt;
  readonly journalPath: string;
}

/** Thrown out of the staging producer so `writeFileAtomicStream` removes its temp; the reason is in the outcome. */
class ResealAborted extends Error {}

/**
 * The append-only receipt journal beside the ledger.
 *
 * @param home the state home
 * @returns the absolute path to `tick-reseals.jsonl`
 */
export function tickResealJournalPath({ home }: { home: string }): string {
  return join(supervisorLedgerDir({ home }), "tick-reseals.jsonl");
}

/**
 * The backup an apply copies the ledger to, named for the instant so a second apply never meets the first's.
 *
 * @param home the state home
 * @param nowIso the apply's instant
 * @returns the absolute path to `supervisor-ticks.pre-reseal-<compact iso>.jsonl`
 */
export function tickResealBackupPath({ home, nowIso }: { home: string; nowIso: string }): string {
  const compact = nowIso.replace(/\.\d+Z$/u, "Z").replace(/[-:]/gu, "");
  return join(supervisorLedgerDir({ home }), `supervisor-ticks.pre-reseal-${compact}.jsonl`);
}

/**
 * Preview a reseal: stream the ledger, count what would change, refuse any defect a reseal does not repair. Writes
 * nothing and takes no lock.
 *
 * @param home the state home
 * @returns the plan, carrying the digest an apply must name, or why the ledger cannot be resealed
 */
export function previewTickReseal({ home }: { home: string }): Result<TickResealPlan, TickResealError> {
  const path = supervisorTickLedgerPath({ home });
  if (!existsSync(path)) {
    return err(TickResealErrors.ledgerUnreadable({ path, why: "it does not exist" }));
  }
  let outcome: PassOutcome;
  try {
    outcome = resealPass({ label: path, source: path, write: undefined });
  } catch (error: unknown) {
    return err(TickResealErrors.ledgerUnreadable({ path, why: String(error) }));
  }
  const refusal = passRefusal({ expected: undefined, outcome, path });
  if (refusal !== undefined) {
    return err(refusal);
  }
  return ok({
    path,
    rowsChanged: outcome.rowsChanged,
    rowsRead: outcome.rowsRead,
    rowsRenderedAsRead: outcome.rowsRenderedAsRead,
    sourceSha256: outcome.sha256,
  });
}

/**
 * Apply a reseal under the tick ledger's lock: back up, rewrite, read back, install, journal.
 *
 * @param home the state home
 * @param sourceSha256 the digest the preview printed; the ledger must still hash to it
 * @param reason why the reseal is being made, journalled on the receipt
 * @param nowIso the instant the lock is taken, the backup named and the receipt stamped at
 * @returns the receipt and where it was journalled, or why nothing was installed
 */
export function applyTickReseal({
  home,
  sourceSha256,
  reason,
  nowIso,
}: {
  home: string;
  sourceSha256: string;
  reason: string;
  nowIso: string;
}): Result<AppliedReseal, TickResealError> {
  return withTickLedgerLock({
    home,
    nowIso,
    onBusy: TickResealErrors.busy,
    section: () => applyUnderLock({ home, nowIso, reason, sourceSha256 }),
  });
}

/**
 * Remove what an apply made before it installed anything, so a refusal leaves the home as it found it.
 *
 * @param paths the backup and the staging file, either of which may not exist
 */
function removeMade({ paths }: { paths: readonly string[] }): void {
  for (const path of paths) {
    rmSync(path, { force: true });
  }
}

/**
 * Copy the ledger to an exclusive owner-only backup, flushed before the pass reads it.
 *
 * @param path the ledger
 * @param backupPath where the copy goes; refused when it already exists
 * @returns nothing, or why the copy was not made
 */
function backUpLedger({ path, backupPath }: { path: string; backupPath: string }): Result<void, TickResealError> {
  try {
    copyFileSync(path, backupPath, constants.COPYFILE_EXCL);
    chmodSync(backupPath, FILE_MODE);
    fsyncFile({ path: backupPath });
    return ok(undefined);
  } catch (cause: unknown) {
    return err(TickResealErrors.writeFailed({ cause, step: `copying the ledger to ${backupPath}` }));
  }
}

/**
 * The apply's critical section, run while the tick ledger's lock is held.
 *
 * @param home the state home
 * @param sourceSha256 the digest the ledger must hash to
 * @param reason why, for the receipt
 * @param nowIso the apply's instant
 * @returns the receipt and its journal, or why nothing was installed
 */
function applyUnderLock({
  home,
  sourceSha256,
  reason,
  nowIso,
}: {
  home: string;
  sourceSha256: string;
  reason: string;
  nowIso: string;
}): Result<AppliedReseal, TickResealError> {
  const path = supervisorTickLedgerPath({ home });
  if (!existsSync(path)) {
    return err(TickResealErrors.ledgerUnreadable({ path, why: "it does not exist" }));
  }
  const backupPath = tickResealBackupPath({ home, nowIso });
  const backedUp = backUpLedger({ backupPath, path });
  if (backedUp.isErr()) {
    return err(backedUp.error);
  }
  const stagingPath = join(supervisorLedgerDir({ home }), "supervisor-ticks.reseal-staging.jsonl");
  const made = [backupPath, stagingPath];
  const staged = stageRewrite({ backupPath, path, sourceSha256, stagingPath });
  if (staged.isErr()) {
    removeMade({ paths: made });
    return err(staged.error);
  }
  const readBack = visitSupervisorTicks({ onTick: () => undefined, path: stagingPath });
  if (readBack.isErr()) {
    removeMade({ paths: made });
    return err(TickResealErrors.readBackFailed({ reasons: supervisorCoreErrorLines({ error: readBack.error }) }));
  }
  const installed = installRewrite({ path, sourceSha256, stagingPath });
  if (installed.isErr()) {
    removeMade({ paths: made });
    return err(installed.error);
  }
  return journalReceipt({
    home,
    receipt: {
      backupPath,
      ledgerPath: path,
      reason,
      resealedAtIso: nowIso,
      resultSha256: installed.value,
      rowsChanged: staged.value.rowsChanged,
      rowsRead: staged.value.rowsRead,
      sourceSha256,
    },
  });
}

/**
 * Append an installed reseal's receipt to the journal beside the ledger.
 *
 * @param home the state home
 * @param receipt what the apply did
 * @returns the receipt and the journal, or why the append failed after the ledger was already resealed
 */
function journalReceipt({
  home,
  receipt,
}: {
  home: string;
  receipt: TickResealReceipt;
}): Result<AppliedReseal, TickResealError> {
  const journalPath = tickResealJournalPath({ home });
  try {
    appendLines({
      durable: true,
      mode: FILE_MODE,
      path: journalPath,
      text: `${safeJsonStringify({ label: "a tick reseal receipt", value: receipt })}\n`,
    });
  } catch (cause: unknown) {
    return err(
      TickResealErrors.writeFailed({
        cause,
        step: `journalling the receipt to ${journalPath} (the ledger IS resealed; its backup is ${receipt.backupPath})`,
      }),
    );
  }
  return ok({ journalPath, receipt });
}

/**
 * Stream the backup into the staging file, rewriting every stale row, and refuse unless the backup hashes to the
 * digest named and the pass stands.
 *
 * @param backupPath the copy the pass reads
 * @param path the ledger, as defects name it
 * @param sourceSha256 the digest the backup must hash to
 * @param stagingPath where the rewrite is staged
 * @returns the pass's tally, or why the rewrite was not staged
 */
function stageRewrite({
  backupPath,
  path,
  sourceSha256,
  stagingPath,
}: {
  backupPath: string;
  path: string;
  sourceSha256: string;
  stagingPath: string;
}): Result<PassOutcome, TickResealError> {
  const state: { outcome: PassOutcome | undefined } = { outcome: undefined };
  try {
    writeFileAtomicStream({
      exactMode: true,
      fileMode: FILE_MODE,
      path: stagingPath,
      produce: ({ write }) => {
        const outcome = resealPass({ label: path, source: backupPath, write });
        state.outcome = outcome;
        if (passRefusal({ expected: sourceSha256, outcome, path }) !== undefined || outcome.rowsChanged === 0) {
          throw new ResealAborted();
        }
      },
    });
  } catch (cause: unknown) {
    if (!(cause instanceof ResealAborted) || state.outcome === undefined) {
      return err(TickResealErrors.writeFailed({ cause, step: `staging the rewritten ledger at ${stagingPath}` }));
    }
    const refusal = passRefusal({ expected: sourceSha256, outcome: state.outcome, path });
    if (refusal !== undefined) {
      return err(refusal);
    }
    return err(TickResealErrors.nothingToReseal({ path }));
  }
  // The producer ran to completion, so the outcome is set — the invariant, never a fallback.
  return ok(state.outcome!);
}

/**
 * Re-hash the live ledger, then rename the staged rewrite over it.
 *
 * @param path the ledger
 * @param sourceSha256 the digest the live ledger must still hash to
 * @param stagingPath the read-back rewrite
 * @returns the installed ledger's sha256, or why it was not installed
 */
function installRewrite({
  path,
  sourceSha256,
  stagingPath,
}: {
  path: string;
  sourceSha256: string;
  stagingPath: string;
}): Result<string, TickResealError> {
  try {
    const live = sha256OfFile({ path });
    if (live !== sourceSha256) {
      return err(TickResealErrors.sourceMoved({ actual: live, expected: sourceSha256 }));
    }
    const resultSha256 = sha256OfFile({ path: stagingPath });
    renameStagedFile({ flushDirectory: true, from: stagingPath, to: path });
    return ok(resultSha256);
  } catch (cause: unknown) {
    return err(TickResealErrors.writeFailed({ cause, step: `installing the rewritten ledger over ${path}` }));
  }
}
