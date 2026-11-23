/**
 * The card-landing ledger on disk: `$SLOPWEAVER_HOME/talk/card-landings.jsonl`, append-only, one row per line.
 *
 * It repeats the owner's transcribed words, so the directory is `0700` and the file `0600`, as the call files beside it
 * are (`./callStore.ts`), and it never leaves the home. A line that does not parse is COUNTED and reported, never
 * silently dropped: a reader presenting a partial overlay as the whole one would put a card the owner already steered
 * back in front of them, which is the defect this ledger exists to end.
 *
 * A landing reads the ledger, decides, registers its work and only then appends, so two `talk transcript` runs of
 * one call — a keepalive batch overtaking the one before it — could each decide off a ledger holding neither's row,
 * and one utterance seen under two anchors would register two dispatch rows. So every landing and
 * restore holds {@link holdCardLandingLock} from its read to its append: the second run reads the first one's row. And
 * `talk transcript` holds it from its read of the CALL, so an older read of the same call cannot land a stale grouping
 * of an utterance after a newer one landed it whole. The wait is a blocking sleep, so a process lands
 * one card at a time — every caller already awaits each landing in turn.
 */
import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { ensureDirectory, fsyncFile } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { CALL_LOCK_WAIT_MS } from "./callLock.js";
import { announceCallWrite, holdAnnouncedLock, holdDrainedCallLock } from "./callWriteIntent.js";
import { type CardLandingRow, cardLandingRowOf } from "./cardLanding.js";
import { type CardLandingError, CardLandingErrors, type LedgerIoError } from "./cardLandingErrors.js";
import { appendCardLedgerRow, type CardLedgerRead, readCardLedger, refusedCardLedgerRow } from "./cardLedgerFile.js";
import { processStartOf, type StartOf } from "./relayLease.js";

/** What a read of the card-landing ledger found. */
export type CardLandingsRead = CardLedgerRead<CardLandingRow>;

/**
 * Where the ledger lives: beside the relay turns and the call files, under the home's own `talk/` directory.
 *
 * @param home the Slopweaver home
 * @returns the ledger's path
 */
export function cardLandingsPath({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "card-landings.jsonl");
}

/**
 * Read the whole ledger. A home that has never landed a word reads as an empty ledger, not a failure.
 *
 * @param home the Slopweaver home
 * @returns the rows and the lines that would not parse, or why the file could not be read
 */
export function readCardLandings({ home }: { home: string }): Result<CardLandingsRead, CardLandingError> {
  return readCardLedger({ label: "card landing", parse: cardLandingRowOf, path: cardLandingsPath({ home }) });
}

/**
 * Why the ledger would refuse this row — it does not round-trip through its own parser — or `undefined` when it
 * would take it. A landing or restore asks BEFORE its first board write, so a row the ledger refuses never leaves a
 * ruling, a re-ask or a dispatch row behind it.
 *
 * @param home the Slopweaver home
 * @param row the row about to be written
 * @returns the refusal, or `undefined`
 */
export function refusedCardLanding({ home, row }: { home: string; row: CardLandingRow }): CardLandingError | undefined {
  return refusedCardLedgerRow({
    label: "card landing",
    parse: cardLandingRowOf,
    path: cardLandingsPath({ home }),
    row,
  });
}

/**
 * Append one row, making the directory `0700` and the file `0600` on first write. The row is round-tripped
 * through its own parser first ({@link refusedCardLanding}), so the ledger never holds a line its reader would refuse.
 * Every byte is written and fsynced (`appendLines`, durable), and a tail an earlier append left unterminated gets its newline
 * first: the row would otherwise fuse onto it, and the retry after a torn append would never read back.
 *
 * @param home the Slopweaver home
 * @param row the row to append
 * @returns the ledger's path
 */
export function appendCardLanding({
  home,
  row,
}: {
  home: string;
  row: CardLandingRow;
}): Result<string, CardLandingError> {
  const refused = refusedCardLanding({ home, row });
  if (refused !== undefined) {
    return err(refused);
  }
  return appendCardLedgerRow({ label: "card landing", parse: cardLandingRowOf, path: cardLandingsPath({ home }), row });
}

/**
 * Take the ledger's write lock, `card-landings.jsonl.lock` beside it, for one landing or restore from its read to
 * its append — or say that a live writer held it past the wait.
 *
 * @param home the Slopweaver home
 * @param waitMs how long to wait for another landing, 10 s unless a test narrows it
 * @param pid the pid the lock names, this process's unless a test stands in another
 * @param startOf a pid's current start time, the real `ps` unless a test makes a holder dead or alive
 * @param reader whether the hold is a binding reader's fence, which waits for every landing already waiting to run
 *   first; a writer's announces itself instead, so such a fence never overtakes it (`./callWriteIntent.ts`)
 * @returns what releases the lock, or why it could not be taken
 */
export function holdCardLandingLock({
  home,
  waitMs = CALL_LOCK_WAIT_MS,
  pid = process.pid,
  reader = false,
  startOf = (candidate) => processStartOf({ pid: candidate }),
}: {
  home: string;
  waitMs?: number;
  pid?: number;
  reader?: boolean;
  startOf?: StartOf;
}): Result<() => void, CardLandingError> {
  const path = cardLandingsPath({ home });
  try {
    ensureDirectory({ directory: dirname(path) });
    chmodSync(dirname(path), 0o700);
    if (reader) {
      return ok(holdDrainedCallLock({ path, pid, startOf, waitMs }));
    }
    return ok(holdAnnouncedLock({ path, pid, startOf, waitMs }));
  } catch (cause) {
    return err(CardLandingErrors.ledgerIo({ cause, path: `${path}.lock` }));
  }
}

/**
 * Announce a landing run on the ledger before it reads anything, so a binding reader's drained hold waits for the
 * whole read-resolve-write, not only its wait for the lock (`./writerRunIntent.ts`).
 *
 * @param home the Slopweaver home
 * @returns what withdraws the intent, run once the run's last ledger write is done, or why it could not be written
 */
export function announceCardLanding({ home }: { home: string }): Result<() => void, LedgerIoError> {
  const path = cardLandingsPath({ home });
  try {
    ensureDirectory({ directory: dirname(path) });
    chmodSync(dirname(path), 0o700);
    return ok(announceCallWrite({ path, pid: process.pid, start: processStartOf({ pid: process.pid }).start }));
  } catch (cause) {
    return err(CardLandingErrors.ledgerIo({ cause, path: `${path}.intent` }));
  }
}

/**
 * Flush the ledger to the device, for a retry that found its own row already there and is about to build on it.
 *
 * @param home the Slopweaver home
 * @returns the ledger's path, or why it could not be flushed
 */
export function flushCardLandings({ home }: { home: string }): Result<string, CardLandingError> {
  const path = cardLandingsPath({ home });
  try {
    fsyncFile({ path });
  } catch (cause) {
    return err(CardLandingErrors.ledgerIo({ cause, path }));
  }
  return ok(path);
}
