/**
 * The effectful half of retiring a seat's board row, and the compensation order it sits in.
 *
 * `./seatRetirementText.ts` carries why the row is retired at all and what makes it safe. This file holds the order:
 * when the session a seat registered a row for does not open, the ROW is retired first and the CLAIMS released only
 * once that is proved. Released first, a retirement that then failed would leave exactly the measured defect — a
 * seatable row whose tokens the ledger no longer holds. Retired first, a failure leaves the claims held, so the row's
 * tokens stay live and a chair that spawns it boots a session `run-due` admits; the claim lapses at its lease.
 *
 * The write follows `../handover/registeredAskWrite.ts`: under the row's lock, the bytes and the journal are read,
 * judged, and read again before an atomic replace, then the row is mirrored the way registration mirrored it.
 *
 * ## The residue, stated
 *
 * `cmux spawn` appends its `dispatched` line only AFTER it opens a workspace and takes no lock this write shares. So a
 * chair that spawns this row in the window between `handover register` writing it and this retirement — and is still
 * opening when the journal is read twice here — has the row cancelled under it, and its session's token is released.
 * That window is the registrar's mirror, or this seat's own refused spawn — not measured, and it is the spawn's own
 * admission time at most, against the 13 minutes one chair took to spawn the row. Releasing the claims with the row still `ready` has
 * the identical window, so retiring the row narrows the defect rather than moving it. Closing it whole needs a lock `cmux spawn` holds across its open, which no other verb has needed.
 *
 * The same holds for ANY other writer interleaving with this one: a hand edit putting the row back to `ready` between
 * the post-mirror re-read and the claims' release, or one that moves the row away and restores it around the absence
 * check. Every check here is a read before an act, and only a lock every writer of the row shares
 * — `cmux spawn` included — would make it otherwise. Nothing in this repository moves a row away and back.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { readRunJournal, runJournalPath } from "../../../handover/runStore.js";
import { entryAt } from "../../../handover/tagStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { foldedAsk } from "../handover/askRowRun.js";
import { withBoardRowLock } from "../handover/boardRowLock.js";
import { mirrorAfterWrite } from "../handover/mirrorAfterWrite.js";
import type { RecipeSeatDeps } from "./seat.js";
import { type SeatedRow, seatAsk } from "./seatAsk.js";
import { releaseSeatedRows } from "./seatClaims.js";
import { type SeatRetirementError, SeatRetirementErrors } from "./seatRetirementErrors.js";
import { retiredSeatRowText } from "./seatRetirementText.js";

/** What retiring found: the row cancelled now, or no row on the board to cancel. Either way nothing seatable stands. */
export type SeatRowRetirement = "absent" | "retired";

/**
 * Cancel the board row a seat registered, when it is still the untouched row the seat wrote.
 *
 * @param home the state home whose board holds the row
 * @param slug the slug the seat registered
 * @param ask the one-line summary the seat registered the row with, which the row must still carry byte for byte
 * @param why what stopped the session opening, one line
 * @returns `retired`, `absent` when no live row stands under the slug, or why the row was left as it was
 */
export async function retireSeatRow({
  home,
  slug,
  ask,
  why,
}: {
  readonly home: string;
  readonly slug: string;
  readonly ask: string;
  readonly why: string;
}): Promise<Result<SeatRowRetirement, SeatRetirementError>> {
  const paths = stateHomePaths({ home });
  const path = join(paths.handovers, `${slug}.md`);
  // Only a real ENOENT is absence. `existsSync` answers false on EACCES too, which would release the claims of a row
  // still standing `ready` behind an unreadable directory.
  try {
    lstatSync(path);
  } catch (cause: unknown) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok("absent");
    }
    return err(SeatRetirementErrors.io({ detail: `cannot tell whether ${path} exists: ${String(cause)}`, slug }));
  }
  const locked = withBoardRowLock({
    path,
    write: ({ target }) => writeRetiredAt({ ask, path, runsDir: paths.runs, slug, target, why }),
  });
  if (locked.isErr()) {
    return err(SeatRetirementErrors.io({ detail: locked.error.message, slug }));
  }
  if (locked.value.isErr()) {
    return err(locked.value.error);
  }
  const mirrorFailed = await mirrorAfterWrite({ home, path, verb: "automation seat" });
  if (mirrorFailed) {
    return err(
      SeatRetirementErrors.io({ detail: "the cancelled row did not reach the authoritative board store", slug }),
    );
  }
  // The lock was released for the mirror, so the row is read once more: a writer that put it back to `ready` in that
  // window keeps the claims held rather than having them released under a seatable row.
  return stillCancelled({ path, slug }).map((): SeatRowRetirement => "retired");
}

/** The row at `path` still reads `cancelled`, or why it does not. */
function stillCancelled({
  path,
  slug,
}: {
  readonly path: string;
  readonly slug: string;
}): Result<void, SeatRetirementError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause: unknown) {
    return err(SeatRetirementErrors.io({ detail: `cannot re-read ${path}: ${String(cause)}`, slug }));
  }
  const status = parseHandoverDoc({ path, text }).status;
  if (status !== "cancelled") {
    return err(SeatRetirementErrors.notOurs({ detail: `it was rewritten to ${status} after it was cancelled`, slug }));
  }
  return ok(undefined);
}

/** {@link retireSeatRow}'s read, judgement and write, run under the row's lock on the real file `target`. */
function writeRetiredAt({
  ask,
  path,
  runsDir,
  slug,
  target,
  why,
}: {
  readonly ask: string;
  readonly path: string;
  readonly runsDir: string;
  readonly slug: string;
  readonly target: string;
  readonly why: string;
}): Result<string, SeatRetirementError> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(target);
  } catch (cause: unknown) {
    return err(SeatRetirementErrors.io({ detail: `cannot read ${path}: ${String(cause)}`, slug }));
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    return err(SeatRetirementErrors.notOurs({ detail: "it is not valid UTF-8", slug }));
  }
  const judged = judgedAgainstJournal({ ask, path, runsDir, slug, text, why });
  if (judged.isErr()) {
    return judged;
  }
  // A last read of the journal, which is not under this lock: a chair that dispatched the row while the edit was
  // computed refuses the write rather than having its session's row cancelled under it.
  const stillOurs = judgedAgainstJournal({ ask, path, runsDir, slug, text, why });
  if (stillOurs.isErr()) {
    return stillOurs;
  }
  try {
    if (!readFileSync(target).equals(bytes)) {
      return err(SeatRetirementErrors.notOurs({ detail: "it changed while the retirement was computed", slug }));
    }
    writeFileAtomic({ contents: judged.value, path: target });
  } catch (cause: unknown) {
    return err(SeatRetirementErrors.io({ detail: `could not write ${path}: ${String(cause)}`, slug }));
  }
  return ok(target);
}

/** The cancelled bytes, judged against the row's journal as it reads at this instant. */
function judgedAgainstJournal({
  ask,
  path,
  runsDir,
  slug,
  text,
  why,
}: {
  readonly ask: string;
  readonly path: string;
  readonly runsDir: string;
  readonly slug: string;
  readonly text: string;
  readonly why: string;
}): Result<string, SeatRetirementError> {
  // The row this seat registered has NO journal entry at all. Judged on the entry itself, never followed: the shared
  // reader follows a symlink and answers a dangling one as an empty journal.
  const journalPath = runJournalPath({ runsDir, slug });
  const entry = entryAt({ path: journalPath });
  if (entry.isErr()) {
    return err(SeatRetirementErrors.io({ detail: entry.error.message, slug }));
  }
  if (entry.value !== undefined) {
    return err(SeatRetirementErrors.notOurs({ detail: `a journal entry stands at ${journalPath}`, slug }));
  }
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return err(SeatRetirementErrors.io({ detail: journal.error.message, slug }));
  }
  return retiredSeatRowText({ ask, journal: journal.value, path, slug, text, why });
}

/**
 * Retire the seat's row, then — only once that is proved — release every claim the seat took.
 *
 * @param deps the seat's edges, whose `retireRow` is {@link retireSeatRow} in production
 * @param home the state home the row and the claims live under
 * @param seated every row the seat claimed, with its token
 * @param slug the board row's slug
 * @param why what stopped the session opening, one line
 * @returns whether the row is gone from the seatable board AND every claim was dropped; `false` when either is not
 */
export async function retireThenReleaseSeat({
  deps,
  home,
  seated,
  slug,
  why,
}: {
  readonly deps: RecipeSeatDeps;
  readonly home: string;
  readonly seated: readonly SeatedRow[];
  readonly slug: string;
  readonly why: string;
}): Promise<boolean> {
  // The very summary `registerArgv` wrote: the same rows render the same ask, folded the way the register folds it.
  const ask = foldedAsk({ ask: seatAsk({ seated }) });
  const retired = await deps.retireRow({ ask, home, slug, why });
  if (retired.isErr()) {
    deps.writeDiagnostic(retired.error.message);
    deps.writeDiagnostic(
      `automation seat · claims KEPT for ${slug}, so the tokens its ask carries stay live — each lapses at its lease`,
    );
    return false;
  }
  if (retired.value === "retired") {
    deps.writeOut(`automation seat · ${slug} cancelled — no session opened on it, so it is not seatable`);
  }
  return releaseSeatedRows({ deps, home, taken: seated });
}
