/**
 * A STRANDED attempt — one that started its run on an EARLIER firing of a row, died, and was never judged
 * because every later take asked only about the firing it was due for.
 *
 * A take judges one slot, `chooseSlot`'s, and for every kind but a per-slot backfill that is the row's LATEST
 * firing. So a seated run that stamps `runStartedAtIso` at 13:05, dies at 13:40, and meets no tick before its
 * 14:00 lease is never read again: the 14:10 tick is due for 14:00, finds nothing there, and fires the row
 * fresh. That is the class the failure hold exists to stop (the calendar and fathom resyncs each carried
 * three such attempts at once), so a take asks about the firings behind its own before it runs.
 *
 * ## Bounded by a count, never by the watermark
 *
 * The walk goes back from the slot being taken, newest first, for {@link STRANDED_LOOKBACK} firings, so one take
 * reads a bounded number of ledger files and never scans the ledger (`./slotLedgerScan.ts` is the release
 * path's, never a tick's). The watermark is NOT the bound, though it looks like one: a run still going past
 * its lease is passed over, its successor can succeed and stamp past it, and when it dies after that its
 * firing sits BEHIND the watermark — a walk stopping there would never see it.
 *
 * ## The row's firings AND every whole hour, because a cadence changes under a dead run
 *
 * The cadence the walk reads is the one the row has NOW. `register-resyncs` re-derives a resync row's cadence
 * from its measured use, so a run that died on a firing of the OLD cadence can sit on an instant the
 * new one never fires. MEASURED: `resync-corpus-gmail` went from every four hours to every twelve, and its
 * early-morning attempt — started, OOMed, never settled — was no longer a firing, so no take would ever
 * judge it and the row escaped its failure hold. So the walk also reads every whole UTC hour in the
 * {@link STRANDED_LOOKBACK} hours behind the slot being taken: every resync cadence is whole-hour, so a death
 * under any earlier one inside two days is found, for at most twice the reads. Its residue, stated: an earlier
 * cadence with a minute offset, or a death older than two days on an instant the row no longer fires.
 *
 * ## A lifted failure hold covers every attempt taken before it
 *
 * A row held on a failure takes nothing until the hold lifts — on its finding's fix, or on the owner's `clearedBy`,
 * which is the owner's word to run the row — so every attempt TAKEN before that hold was placed is the hold's,
 * already answered. MEASURED on `resync-corpus-github`: one heap-OOM outage stranded two consecutive firings; the
 * later death held the row, its finding was answered with the fix and a green resync, and thirteen minutes later
 * the next take walked back to the OLDER death of the same outage and held the row again — one hold, fix and settle cycle per stranded firing, for a cause
 * already answered. So the walk passes over an attempt whose `startedAtIso` is earlier than the lifted failure
 * hold's `askedIso` (`coveredBeforeIso`, `./failureHoldStore.ts#liftedFailureHoldAskedIso`); one taken after it
 * is judged exactly as before. Its residue, stated: a run taken before the hold that stays alive through the
 * hold and the lift and dies after is passed over, and a covered attempt stays unsettled on its own ledger
 * file until it ages out of the walk.
 */
import { CronExpressionParser } from "cron-parser";

import { holderAliveFor, type ProcessAlive } from "./holderLiveness.js";
import { judgeSlotAttempt, type RecipeSlotVerdict } from "./slotAttempt.js";
import { readSlotAttempt } from "./slotLedger.js";

/**
 * How far back a take looks — this many of the row's own firings, and this many whole hours. 48 hourly
 * firings is two days, and a stranded attempt older than that was already past two leases nobody judged.
 */
export const STRANDED_LOOKBACK = 48;

const HOUR_MS = 3_600_000;

/**
 * Every instant the walk reads, newest first and each once: the row's last {@link STRANDED_LOOKBACK} firings
 * behind `slotIso`, and every whole UTC hour strictly behind it for as many hours.
 *
 * @param cadence the row's cron expression, to walk its firings backwards
 * @param slotIso the firing being taken, exclusive
 * @returns the instants to read, or `null` when the cadence cannot be parsed
 */
function walkedSlots({ cadence, slotIso }: { cadence: string; slotIso: string }): readonly string[] | null {
  let iterator;
  try {
    iterator = CronExpressionParser.parse(cadence, { currentDate: new Date(slotIso) });
  } catch {
    // The take's own lease read refuses an unschedulable cadence in the same breath; nothing to walk here.
    return null;
  }
  const instants = new Set<number>();
  let behind = Date.parse(slotIso);
  try {
    for (let walked = 0; walked < STRANDED_LOOKBACK; walked += 1) {
      const firing = iterator.prev().getTime();
      // Around a half-hour clock change prev() can answer the slot itself or an instant AFTER it (Australia/
      // Lord_Howe): a take never judges a firing that is not behind it.
      if (firing >= behind) {
        break;
      }
      instants.add(firing);
      behind = firing;
    }
  } catch {
    // Across the same kind of change prev() can throw "loop limit exceeded" instead.
    // The firings already read stand, and the whole hours below still cover the two days behind the take — a
    // throw here must never crash the take itself.
  }
  const newestHour = Math.ceil(Date.parse(slotIso) / HOUR_MS) * HOUR_MS - HOUR_MS;
  for (let walked = 0; walked < STRANDED_LOOKBACK; walked += 1) {
    instants.add(newestHour - walked * HOUR_MS);
  }
  return [...instants].toSorted((a, b) => b - a).map((instant) => new Date(instant).toISOString());
}

/** An earlier firing whose attempt ran and was abandoned, and what the ledger says about it. */
export interface StrandedAttempt {
  readonly slotIso: string;
  readonly verdict: Extract<RecipeSlotVerdict, { kind: "abandoned" }>;
}

/**
 * The newest earlier firing of this row whose attempt STARTED its run and was abandoned with nothing settled.
 *
 * An attempt that never started is not stranded — nothing ran under it, and the take ahead of it covers the
 * world anyway — and neither is one whose holder still runs. A row that cannot be read is passed over: the
 * take's own slot is still judged by the ledger, and refusing a take on an old unreadable file would turn one
 * corrupt row into a row that never runs.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row being taken
 * @param cadence the row's cron expression, to walk its firings backwards
 * @param slotIso the firing being taken, exclusive
 * @param nowIso the reference instant
 * @param processAlive probes a stored attempt's holder pid
 * @param coveredBeforeIso when the row's lifted failure hold was placed — an attempt taken before it is that
 *   hold's, already answered by its fix or the owner's `clearedBy`; `null` when the row carries no lifted failure hold
 * @returns the stranded attempt, or `null` when none stands behind this slot
 */
export function findStrandedAttempt({
  home,
  recipeId,
  cadence,
  slotIso,
  nowIso,
  processAlive,
  coveredBeforeIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly cadence: string;
  readonly slotIso: string;
  readonly nowIso: string;
  readonly processAlive: ProcessAlive;
  readonly coveredBeforeIso: string | null;
}): StrandedAttempt | null {
  const slots = walkedSlots({ cadence, slotIso });
  if (slots === null) {
    return null;
  }
  for (const firingIso of slots) {
    const stored = readSlotAttempt({ home, recipeId, slotIso: firingIso });
    if (stored.isErr() || stored.value === null) {
      continue;
    }
    if (coveredBeforeIso !== null && Date.parse(stored.value.startedAtIso) < Date.parse(coveredBeforeIso)) {
      continue;
    }
    const holderAlive = holderAliveFor({ processAlive, stored: stored.value });
    // A holder still running past its lease reads abandoned too. It is a long run, not a dead one — the
    // lease is never renewed mid-run (`AGENTS.md` rule 2) — so it is passed over rather than killed, and a
    // later take finds it once it is gone.
    if (holderAlive === true) {
      continue;
    }
    const verdict = judgeSlotAttempt({ holderAlive, nowIso, stored: stored.value });
    if (verdict.kind === "abandoned" && verdict.ran) {
      return { slotIso: firingIso, verdict };
    }
  }
  return null;
}
