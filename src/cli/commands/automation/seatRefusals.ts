/**
 * Which firings `automation seat` steps past rather than seats — the ledger's refusal, read while the seat plans.
 *
 * Split from `./seat.ts` along that seam: everything here reads and judges, nothing claims, opens or
 * releases. The seat's own order of operations stays in `./seat.ts`.
 */

import { readSignInProbes } from "../../../browser/signInProbeStore.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type DueAskReport, type DueAskRow } from "../../../live/automation/dueReport.js";
import { holderAliveFor, type ProcessAlive } from "../../../live/automation/holderLiveness.js";
import { RESYNC_KIND } from "../../../live/automation/kinds.js";
import { coolingWhy, judgeSlotAttempt, type RecipeSlotVerdict } from "../../../live/automation/slotAttempt.js";
import { readSlotAttempt } from "../../../live/automation/slotLedger.js";
import { readResyncState } from "../../../live/resync/outcomeStore.js";
import {
  fleetSignInHold,
  hostOf,
  type SignInCardHistory,
  signInAnswered,
  signInSubjectKey,
} from "../../../monitor/resyncSignedOut.js";
import { readSignInCards } from "../../../monitor/resyncSignedOutSource.js";
import { stateHomePaths } from "../../../stateHome.js";
import { RecipeCommandErrors, type RecipeCommandSlotAttemptUnreadableError } from "./errors.js";

/**
 * A due row the ledger will not hand its current firing over for, and the words for why.
 *
 * Only the verdicts an ACTIONABLE row can still be carrying reach here. `held` never does, and neither does
 * a lease-expired `abandoned`: both leave the attempt's outcome `null`, and `openAttempts` (`./due.ts`)
 * reports those rows as held. An attempt whose in-process holder pid is GONE is the one abandoned row
 * `openAttempts` does not report held — `refusalWhy` answers `undefined` for it, and the take resolves it.
 */
export interface UnseatableRow {
  readonly recipeId: string;
  readonly slotIso: string;
  /**
   * What the ledger answered, worded exactly as `automation run-due` words the same refusal — so one firing
   * reads the same whether a tick met it or a seat stepped past it.
   */
  readonly why: string;
}

/**
 * The line a row passed over prints — the facts `automation run-due` prints for the same refusal, plus what the
 * seat did about it. Pure.
 *
 * @param row the row this seat stepped past
 * @returns the line to print
 */
export function unseatableSkipLine({ row }: { readonly row: UnseatableRow }): string {
  return `recipe ${row.recipeId} · slot ${row.slotIso} · ${row.why} · skipped, not seated`;
}

/**
 * Why a seat took no row, in the words of whether `--recipe` named one and whether the ledger is why. Pure.
 *
 * A named row that is not seatable is a different fact from an empty ranking: the chair asked about ONE
 * row, so the answer names it and points at the verb that says which of the three reasons applies. A row
 * stepped past has already printed the ledger's own words for its firing, so this line only has to say
 * that the ledger is what emptied the seat rather than an exhausted ranking.
 *
 * @param recipeId the id `--recipe` named, or `null` when the seat took the prefix of the ranking
 * @param refused whether every row this seat could have taken was stepped past
 * @returns the line to print
 */
export function emptySeatLine({
  recipeId,
  refused,
}: {
  readonly recipeId: string | null;
  readonly refused: boolean;
}): string {
  if (recipeId !== null) {
    if (refused) {
      return `automation seat · the ledger will not hand ${recipeId} over yet, so this seat took nothing`;
    }
    return (
      `automation seat · ${recipeId} is not an actionable row that needs a session — it is ` +
      "inside its cadence, already claimed, or runs in the tick itself; `slopweaver automation due` says which"
    );
  }
  if (refused) {
    return "automation seat · nothing to seat now — the ledger refuses every actionable spawn-shaped row";
  }
  return "automation seat · nothing needs a session — no actionable row is spawn-shaped";
}

/**
 * The words for a verdict the ledger will refuse, or `undefined` when it would hand the firing over.
 *
 * The wording is `quietRefusalLine`'s (`./slotRun.ts`) verbatim, so one firing reads identically whether a
 * tick met it or a seat stepped past it. `held` and `abandoned` are absent on purpose: `openAttempts`
 * reports a lease-held row held, so the report never marks it actionable, and a row whose holder pid is gone
 * is actionable precisely so the take can dead-letter or retake it. Pure.
 *
 * @param verdict what the ledger answered for this firing
 * @returns why the seat may not take it, or `undefined` when it may
 */
function refusalWhy({ verdict }: { readonly verdict: RecipeSlotVerdict }): string | undefined {
  if (verdict.kind === "cooling") {
    return coolingWhy({ verdict });
  }
  if (verdict.kind === "exhausted") {
    return `EXHAUSTED · every attempt this slot gets has been spent, the last on ${verdict.previousDetail}`;
  }
  if (verdict.kind === "settled") {
    return `already ${verdict.outcome.kind} — nothing to run`;
  }
  return undefined;
}

/**
 * Which actionable spawn-shaped rows the ledger will refuse, read at the firing the report names — and which
 * resync rows it would hand over that still wait on the owner's sign-in.
 *
 * @param home the state home the ledger lives under
 * @param report the due report the seat plans from
 * @param nowIso the reference instant the retry floors are judged at
 * @param processAlive probes an open attempt's holder pid, the same reading the ledger's own take makes
 * @returns the rows to step past, by recipe id, or why a firing's record could not be read
 */
export function unseatableRows({
  home,
  report,
  nowIso,
  processAlive,
}: {
  readonly home: string;
  readonly report: DueAskReport;
  readonly nowIso: string;
  readonly processAlive: ProcessAlive;
}): Result<ReadonlyMap<string, UnseatableRow>, RecipeCommandSlotAttemptUnreadableError> {
  const unseatable = new Map<string, UnseatableRow>();
  let cards: Result<ReadonlyMap<string, SignInCardHistory>, string> | undefined;
  const signIns = (): Result<ReadonlyMap<string, SignInCardHistory>, string> => {
    if (cards !== undefined) {
      return cards;
    }
    const read = readSignInCards({ home });
    cards = read;
    return read;
  };
  for (const row of report.rows) {
    if (!row.actionable || row.shape !== "spawn" || row.slotIso === null) {
      continue;
    }
    const stored = readSlotAttempt({ home, recipeId: row.recipeId, slotIso: row.slotIso });
    if (stored.isErr()) {
      return err(RecipeCommandErrors.slotAttemptUnreadable({ cause: stored.error }));
    }
    const holderAlive = holderAliveFor({ processAlive, stored: stored.value });
    const refused = refusalWhy({ verdict: judgeSlotAttempt({ holderAlive, nowIso, stored: stored.value }) });
    if (refused !== undefined) {
      unseatable.set(row.recipeId, { recipeId: row.recipeId, slotIso: row.slotIso, why: refused });
      continue;
    }
    const waiting = signInWaitFor({ home, nowIso, row, signIns });
    if (waiting !== undefined) {
      unseatable.set(row.recipeId, { recipeId: row.recipeId, slotIso: row.slotIso, why: waiting });
    }
  }
  return ok(unseatable);
}

/**
 * The words for a resync row still waiting on the owner's sign-in, or `undefined` when nothing waits.
 *
 * A resync that met a sign-in page gives its attempt back rather than failing it
 * (`../../../live/resync/outcome.ts#resyncExitCode`), so the ledger alone would hand the row straight over and
 * the next session would walk into the same page. The wait is read off the TARGET's own record, which names the
 * wall, and the hand register, which says whether the owner's card was settled since — the same rule that holds the owner's
 * card (`../../../monitor/resyncSignedOut.ts#signInAnswered`), so the row is seated the pass after the owner presses
 * Done and not a pass before. A register that does not read waits too: without it nothing can say the owner signed in.
 *
 * A Datadog or GitHub wall with no fresh look that reached the owner's hands waits on nothing: the monitor holds its card
 * (`../../../monitor/resyncSignedOut.ts#fleetSignInHold`), so the row is seated and the
 * seated session presses the wall with `browser sign-in` — a wait here would be a stall no card ever ends.
 *
 * @param home the state home the record lives under
 * @param nowIso the instant a sign-in look's freshness is judged at
 * @param row the due row the ledger would hand over
 * @param signIns the hand register's card history, read at most once per seat
 * @returns why the row waits, or `undefined` when it may be seated
 */
function signInWaitFor({
  home,
  nowIso,
  row,
  signIns,
}: {
  readonly home: string;
  readonly nowIso: string;
  readonly row: DueAskRow;
  readonly signIns: () => Result<ReadonlyMap<string, SignInCardHistory>, string>;
}): string | undefined {
  if (row.kind !== RESYNC_KIND) {
    return undefined;
  }
  const state = readResyncState({
    recipeId: row.recipeId,
    stateDir: stateHomePaths({ home }).live.recipe.resyncStateDir,
  });
  // An unreadable record is the verb's own refusal to make (`automation resync` refuses it before any step runs).
  if (state.isErr() || state.value === null) {
    return undefined;
  }
  const wall = state.value.lastAttempt;
  if (wall?.outcome !== "failed" || wall.signInWall === undefined) {
    return undefined;
  }
  const host = hostOf({ origin: wall.signInWall });
  // An unreadable look ledger reads as no look, exactly as the monitor reads it, so the two cannot disagree — and
  // says so, as the monitor's blind spot does, rather than seating the row over a ledger nobody knows is broken.
  const probes = readSignInProbes({ home });
  if (probes.isErr()) {
    logger.error({ msg: `automation seat: ${probes.error.message}; ${host}'s wall is held as unlooked` });
  }
  const looks = probes.isOk() ? probes.value : [];
  if (fleetSignInHold({ nowIso, origin: wall.signInWall, probes: looks }) !== undefined) {
    return undefined;
  }
  const cards = signIns();
  if (cards.isErr()) {
    return `AWAITING SIGN-IN · stopped at ${host}'s sign-in page at ${wall.finishedAtIso}, and ${cards.error}`;
  }
  if (signInAnswered({ cards: cards.value, origin: wall.signInWall, wallIso: wall.finishedAtIso })) {
    return undefined;
  }
  return (
    `AWAITING SIGN-IN · stopped at ${host}'s sign-in page at ${wall.finishedAtIso}; seated again the moment their ` +
    `card mon-signin-${signInSubjectKey({ origin: wall.signInWall })} is settled`
  );
}
