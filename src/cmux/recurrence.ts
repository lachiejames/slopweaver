/**
 * Whether a cmux hang is the same failure coming back: it began within the hour after a restart that brought cmux
 * back answering. A recurring hang is named in the revive journal, reads `degraded` on fleet health, and is
 * restarted once more at most — a hang recurring after a restart that was itself for a recurring hang is HELD, so a
 * crash loop is named rather than silently pressed (`skills/supervisor/reference/reboot.md` § crash loops). A held
 * hang's `restart-held` marker carries the hold past the journal tail's horizon.
 *
 * MEASURED (`~/.slopweaver/fleet/cmux-revive.jsonl`): the fleet restarted cmux, it hung
 * again, was restarted, and hung again — each time 11 to 19 minutes after
 * the reopen. The cause was one modal dialog cmux re-raised after each reopen (`./dialog.ts`).
 *
 * Pure: journal events in, a recurrence or a hold out. The decline of the dialog is `./dialogEffects.ts`.
 */
import type { CmuxReviveEvent } from "./reviveJournal.js";

/** How soon after a restart came up answering a new hang counts as the same failure coming back. */
const RECURRENCE_WINDOW_MS = 60 * 60_000;

/**
 * How late a hang's first reading may be stamped after the hang itself began: the desktop app runs one revive pass a
 * minute, so a hang beginning just inside the hour is first read up to a pass later, plus the pass's own probe. A
 * hang's FIRST READING is what the journal dates, so the hour is judged with this much slack, toward the hold — a
 * hang that began at 59m50s and was first read at 60m10s is still inside it.
 */
const FIRST_READING_LAG_MS = 2 * 60_000;

/** The window as judged on first readings: the hour, plus how late a first reading may land. */
const JUDGED_WINDOW_MS = RECURRENCE_WINDOW_MS + FIRST_READING_LAG_MS;

/** A hang that came back after a restart: when it began, which restart it followed, and how long after. */
export interface CmuxRecurrence {
  readonly hungSinceIso: string;
  readonly afterRestartIso: string;
  readonly intervalMs: number;
}

/**
 * One restart as the journal tells it: its start, the hang it was for, and its finish when one was written — each
 * with its journal index, since which came first is read off the journal's append order, never its stamps.
 */
interface Restart {
  readonly startedIso: string;
  readonly startIndex: number;
  readonly hungSinceIso: string;
  readonly finished: { readonly atIso: string; readonly outcome: string; readonly index: number } | undefined;
}

/** An ISO instant's milliseconds, or `undefined` for a string that names none. */
function msOf({ iso }: { iso: string }): number | undefined {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Every restart in journal order, each finish paired with the nearest unmatched start before it. A finish with no
 * start is dropped; a start a second start overtook stays unfinished.
 */
function restartsOf({ events }: { events: readonly CmuxReviveEvent[] }): readonly Restart[] {
  const restarts: Restart[] = [];
  let pending: Restart | undefined;
  for (const [index, event] of events.entries()) {
    if (event.kind === "restart-started") {
      if (pending !== undefined) {
        restarts.push(pending);
      }
      pending = { finished: undefined, hungSinceIso: event.hungSinceIso, startIndex: index, startedIso: event.atIso };
    } else if (event.kind === "restart-finished" && pending !== undefined) {
      restarts.push({ ...pending, finished: { atIso: event.atIso, index, outcome: event.outcome } });
      pending = undefined;
    }
  }
  if (pending !== undefined) {
    restarts.push(pending);
  }
  return restarts;
}

/**
 * Where a hang sits in the journal: the index of its first reading, or -1 when the tail no longer holds it, so the
 * hang began before everything the tail shows. Order is the journal's append order, never the stamps: a wall clock
 * set back after a restart stamps a later hang earlier than that restart, while its first
 * reading is still appended after the restart's lines.
 */
function hangPosition({ events, hungSinceIso }: { events: readonly CmuxReviveEvent[]; hungSinceIso: string }): number {
  return events.findLastIndex((event) => event.kind === "reading" && event.atIso === hungSinceIso);
}

/**
 * Whether the hang beginning at journal index `position` is a recurrence: the newest restart finished before it came
 * up answering, and the hang's stamp is within the window after that finish. A stamp EARLIER than the finish is a
 * clock set back, so it counts as within.
 */
function recurrenceAt({
  events,
  hungSinceIso,
  position,
}: {
  events: readonly CmuxReviveEvent[];
  hungSinceIso: string;
  position: number;
}): CmuxRecurrence | undefined {
  const hungMs = msOf({ iso: hungSinceIso });
  if (hungMs === undefined) {
    return undefined;
  }
  const newest = restartsOf({ events }).findLast(
    (restart) => restart.startIndex < position && (restart.finished === undefined || restart.finished.index < position),
  );
  if (newest === undefined) {
    return undefined;
  }
  const recoveredIso = recoveryOf({ events, position, restart: newest });
  const recoveredMs = recoveredIso === undefined ? undefined : msOf({ iso: recoveredIso });
  if (recoveredIso === undefined || recoveredMs === undefined) {
    return undefined;
  }
  const intervalMs = Math.max(0, hungMs - recoveredMs);
  if (intervalMs > JUDGED_WINDOW_MS) {
    return undefined;
  }
  return { afterRestartIso: recoveredIso, hungSinceIso, intervalMs };
}

/**
 * When a restart is proven to have brought cmux back answering before journal index `position`: its finish line when
 * that says answering, else — when the finish was never journalled, a full disk failing that one append —
 * the first answering reading after its start. A finish that did not answer proves no recovery.
 */
function recoveryOf({
  events,
  restart,
  position,
}: {
  events: readonly CmuxReviveEvent[];
  restart: Restart;
  position: number;
}): string | undefined {
  if (restart.finished !== undefined) {
    return restart.finished.outcome === "answering" ? restart.finished.atIso : undefined;
  }
  const answered = events.find(
    (event, index) =>
      index > restart.startIndex && index < position && event.kind === "reading" && event.state === "answering",
  );
  return answered?.atIso;
}

/**
 * Whether a hang that began at `hungSinceIso` is a recurrence: the newest restart journalled as finished before the
 * hang's first reading came up answering, and the hang began within the window after that finish. A restart that
 * never answered proves no recovery, so a hang after it is that same hang continuing, never a recurrence. A hang
 * whose first reading the tail has lost began before every restart it shows, so it is a first one here.
 *
 * @param events the journal
 * @param hungSinceIso the first reading of the hang's unanswered run
 * @returns the recurrence, or `undefined` when the hang is a first one
 */
export function recurrenceForHang({
  events,
  hungSinceIso,
}: {
  events: readonly CmuxReviveEvent[];
  hungSinceIso: string;
}): CmuxRecurrence | undefined {
  return recurrenceAt({ events, hungSinceIso, position: hangPosition({ events, hungSinceIso }) });
}

/**
 * Where the hang a restart was for really began: its first reading that saw a seat's call go unanswered after the
 * last answer before the restart — an answering reading, or an earlier restart's finish line saying answering. The
 * restart's own `hungSinceIso` is the run as the revive dated it, and a
 * run re-dated after minutes of `unprobed` readings — no seat calling, so nothing proved cmux either way — starts
 * late, while cmux was never seen answering in between. `unprobed` proves nothing, so it never
 * begins one. With no such reading in the tail, the restart's own date stands.
 */
function hangOnsetOf({ events, restart }: { events: readonly CmuxReviveEvent[]; restart: Restart }): {
  readonly iso: string;
  readonly index: number;
} {
  const lastAnswer = events.findLastIndex(
    (event, index) =>
      index < restart.startIndex &&
      ((event.kind === "reading" && event.state === "answering") ||
        (event.kind === "restart-finished" && event.outcome === "answering")),
  );
  const onset = events.findIndex(
    (event, index) =>
      index > lastAnswer &&
      index < restart.startIndex &&
      event.kind === "reading" &&
      event.state !== "answering" &&
      event.state !== "unprobed",
  );
  const found = events[onset];
  if (found === undefined) {
    return { index: restart.startIndex, iso: restart.hungSinceIso };
  }
  return { index: onset, iso: found.atIso };
}

/** The recurrence of the hang a restart was for, judged from where that hang really began. */
function recurrenceOfRestart({
  events,
  restart,
}: {
  events: readonly CmuxReviveEvent[];
  restart: Restart;
}): CmuxRecurrence | undefined {
  const onset = hangOnsetOf({ events, restart });
  return recurrenceAt({ events, hungSinceIso: onset.iso, position: onset.index });
}

/**
 * Whether a `recurring` line names the hang a restart was for: under its own date, where it really began, or as a
 * line before the restart that cmux never answered after. That last is the same hang continuing however it was
 * re-dated, and it is what still holds once a hang of days has pushed its first reading and the restart it
 * recurred after out of the tail — the line itself is re-stated to stay inside it.
 */
function recurrenceJournalledFor({
  events,
  restart,
}: {
  events: readonly CmuxReviveEvent[];
  restart: Restart;
}): boolean {
  const onsetIso = hangOnsetOf({ events, restart }).iso;
  const named = events.some(
    (event) =>
      event.kind === "recurring" && (event.hungSinceIso === restart.hungSinceIso || event.hungSinceIso === onsetIso),
  );
  return named || openRecurrenceBefore({ events, position: restart.startIndex }) !== undefined;
}

/**
 * The newest `recurring` line before index `position` when cmux has not answered since the hang it names began, by
 * both append order and stamp, so that hang is still the one open at `position`.
 *
 * @param events the journal, or its bounded tail
 * @param position the journal index the hang is judged open at
 * @returns that line's index, or `undefined`
 */
export function openRecurrenceBefore({
  events,
  position,
}: {
  events: readonly CmuxReviveEvent[];
  position: number;
}): number | undefined {
  const index = events.findLastIndex((event, at) => at < position && event.kind === "recurring");
  const line = events[index];
  if (line?.kind !== "recurring") {
    return undefined;
  }
  const sinceMs = msOf({ iso: line.hungSinceIso });
  if (sinceMs === undefined) {
    return undefined;
  }
  return answeredBetween({ events, from: index, sinceMs, to: position - 1 }) ? undefined : index;
}

/**
 * Whether the journal already names this recurrence, so repeated probes of one hang write one line.
 *
 * @param events the journal
 * @param recurrence the recurrence judged now
 * @returns whether a `recurring` event for the same hang and restart is there
 */
export function recurrenceWasJournalled({
  events,
  recurrence,
}: {
  events: readonly CmuxReviveEvent[];
  recurrence: CmuxRecurrence;
}): boolean {
  return events.some(
    (event) =>
      event.kind === "recurring" &&
      event.hungSinceIso === recurrence.hungSinceIso &&
      event.afterRestartIso === recurrence.afterRestartIso,
  );
}

/**
 * The newest restart journalled before index `position`, and the end of the window it opens: its finish, or its
 * start when the finish line was never written — a restart takes seconds, so the window is that much short at most.
 */
function restartBefore({ events, position }: { events: readonly CmuxReviveEvent[]; position: number }):
  | {
      readonly restart: Restart;
      readonly endMs: number;
    }
  | undefined {
  const restart = restartsOf({ events }).findLast((candidate) => candidate.startIndex < position);
  if (restart === undefined) {
    return undefined;
  }
  const endIso = restart.finished === undefined ? restart.startedIso : restart.finished.atIso;
  const endMs = msOf({ iso: endIso });
  return endMs === undefined ? undefined : { endMs, restart };
}

/**
 * Whether cmux answered in a reading journalled after index `from` and at or before index `to`, and stamped at or
 * after `sinceMs`. Only an answer proves a hang ended: a declined dialog restarts the bound, but a cmux still
 * unanswered after it is the same hang, and a tail that has lost the readings between is read
 * as no answer, the held side. Both orders must agree: a revive paused between its probe and its append journals an
 * answer from BEFORE the hang after the marker, and a clock set back stamps a later one
 * earlier — where they disagree the hold stands until a reading both journalled and stamped after it answers.
 */
function answeredBetween({
  events,
  from,
  to,
  sinceMs,
}: {
  events: readonly CmuxReviveEvent[];
  from: number;
  to: number;
  sinceMs: number;
}): boolean {
  return events.some((event, index) => {
    const atMs = msOf({ iso: event.atIso });
    return (
      index > from &&
      index <= to &&
      event.kind === "reading" &&
      event.state === "answering" &&
      atMs !== undefined &&
      atMs >= sinceMs
    );
  });
}

/**
 * The hang a restart for the run beginning at `hungSinceIso` is held for, as its first reading, or `undefined` when
 * the restart is not held. Held when the restart before it was itself for a recurring hang and this hang began within
 * the window after that restart ended: the fleet self-heals a hang, and a recurrence once more, and a third is the
 * defect to investigate, never a loop to press. Keyed on the hang, never the clock, and carried
 * by the newest `restart-held` marker past the restarts leaving the tail and past a declined
 * dialog, so the hold ends only when cmux answers.
 *
 * Which restart came before the hang, and whether cmux answered since the marker, are read off the journal's append
 * order, so a wall clock set back cannot stamp a third hang earlier than the loop's restart and slip the hold;
 * a hang stamped before that restart's end counts as within the window. What this does NOT close: a
 * clock set FORWARD by more than the window between the restart and the hang reads as an hour gone, and the journal
 * cannot tell, because an answering cmux appends no reading per probe — only a monotonic clock in each line would.
 *
 * @param events the journal, or its bounded tail
 * @param hungSinceIso the first reading of the open hang's run as the tail shows it
 * @returns the held hang's first reading, or `undefined`
 */
export function recurringHoldOrigin({
  events,
  hungSinceIso,
}: {
  events: readonly CmuxReviveEvent[];
  hungSinceIso: string;
}): string | undefined {
  const hungMs = msOf({ iso: hungSinceIso });
  if (hungMs === undefined) {
    return undefined;
  }
  const position = hangPosition({ events, hungSinceIso });
  const previous = restartBefore({ events, position });
  // The restart before was for a recurring hang: re-derived, or — once the restart before THAT has left the tail —
  // read off the `recurring` line the revive journalled for it.
  const previousRecurred =
    previous !== undefined &&
    (recurrenceOfRestart({ events, restart: previous.restart }) !== undefined ||
      recurrenceJournalledFor({ events, restart: previous.restart }));
  const afterLoop = previousRecurred && hungMs - previous.endMs <= JUDGED_WINDOW_MS;
  if (afterLoop) {
    return hungSinceIso;
  }
  const markerIndex = events.findLastIndex((event) => event.kind === "restart-held");
  const marker = events[markerIndex];
  if (marker?.kind !== "restart-held") {
    return undefined;
  }
  // From the held hang's own first reading when the tail still holds it, else from the marker, which is only ever
  // written while that hang is unanswered.
  const heldPosition = events.findLastIndex(
    (event, index) => index < markerIndex && event.kind === "reading" && event.atIso === marker.hungSinceIso,
  );
  const from = heldPosition < 0 ? markerIndex : heldPosition;
  const heldMs = msOf({ iso: marker.hungSinceIso });
  if (heldMs === undefined) {
    return undefined;
  }
  return answeredBetween({ events, from, sinceMs: heldMs, to: position }) ? undefined : marker.hungSinceIso;
}

/** What fleet health shows of a recurrence: which restart the hang came back after, and how long after. */
export interface CmuxFleetRecurrence {
  readonly afterRestartIso: string;
  readonly intervalMs: number;
}

/**
 * The recurrence fleet health carries: the open hang's own, else that of the newest restart when it was for a
 * recurring hang and is in flight or ended within the window. So the hour after a loop's restart still reads
 * degraded while cmux answers, and the mark expires on its own.
 *
 * @param events the journal
 * @param openHangSinceIso the first reading of the open hang's run, when one is open
 * @param nowIso the instant judged
 * @returns the recurrence to show, or `undefined`
 */
export function fleetRecurrence({
  events,
  openHangSinceIso,
  nowIso,
}: {
  events: readonly CmuxReviveEvent[];
  openHangSinceIso: string | undefined;
  nowIso: string;
}): CmuxFleetRecurrence | undefined {
  if (openHangSinceIso !== undefined) {
    const open = recurrenceForHang({ events, hungSinceIso: openHangSinceIso });
    if (open !== undefined) {
      return { afterRestartIso: open.afterRestartIso, intervalMs: open.intervalMs };
    }
  }
  const nowMs = Date.parse(nowIso);
  const previous = restartBefore({ events, position: events.length });
  if (previous === undefined || nowMs - previous.endMs > RECURRENCE_WINDOW_MS) {
    return undefined;
  }
  const recurred = recurrenceOfRestart({ events, restart: previous.restart });
  if (recurred === undefined) {
    return undefined;
  }
  return { afterRestartIso: recurred.afterRestartIso, intervalMs: recurred.intervalMs };
}
