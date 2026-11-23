/**
 * The keys a notice monitor holds off its reading because the owner closed their card — read from the hand register.
 *
 * Shared by `meeting-prep-due` and `org-health`, the two notices whose subject still reads true after the owner's Done: a
 * meeting still due, an incident still at the severity the owner was paged about. Without the hold the next tick re-posts the
 * card the owner just closed and floats it again. The fold itself, and why a pass's own departure does NOT hold, is
 * `./meetingPrepDue.ts`'s {@link dismissedKeys}.
 *
 * `recipe-stopped` and `recipe-repairing` read a narrower fold, {@link closedByOwner}: only the owner's own close holds a set,
 * because one that cleared on its own and came back is news.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type HandRow, isSettledRow } from "../hand/row.js";
import { handRegisterPath, readHandRows } from "../hand/store.js";

import {
  clearedBy,
  departedWhileFiring,
  PUT_DOWN_SETTLE_OPENINGS,
  SUPERSEDED_SETTLE_OPENING,
  steeredBy,
} from "./card.js";
import { dismissedKeys } from "./meetingPrepDue.js";
import { MONITOR_STEP_PREFIX, type MonitorDefinition, occurrenceBase } from "./registry.js";
import { signInCardHistory } from "./resyncSignedOutSource.js";

/**
 * Every key whose card was posted and is no longer open, whoever took it down — the owner's Done or the pass's own
 * departure. `org-health` holds all of these: its key is a loud MOMENT, which never becomes news again, so a key
 * that comes back (a newer page's incident aged out of the snapshot, leaving an older one the newest) is one the
 * owner was already shown.
 *
 * @param settles every settle of this monitor's cards: its key, and whether the pass departed it
 * @param open the keys with a card still open, which nothing holds
 * @returns the keys already shown and taken down
 */
export function shownKeys({
  settles,
  open,
}: {
  settles: readonly { key: string; departed: boolean }[];
  open: ReadonlySet<string>;
}): ReadonlySet<string> {
  return new Set(settles.flatMap((settle) => (open.has(settle.key) ? [] : [settle.key])));
}

/**
 * Read which of a monitor's keys the owner closed, and which were shown at all.
 *
 * @param home the state home the hand register lives under
 * @param definition the monitor whose cards are read
 * @returns the keys the owner closed, the keys already shown and taken down, and the keys whose card is up now, or why the
 *   register could not be read — a caller answers `unmeasurable` on that, because without the history a card the owner
 *   closed would be re-posted over their Done
 */
export function readHeldKeys({ home, definition }: { home: string; definition: MonitorDefinition }): Result<
  {
    readonly dismissed: ReadonlySet<string>;
    readonly shown: ReadonlySet<string>;
    readonly open: ReadonlySet<string>;
  },
  string
> {
  const register = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (register.isErr()) {
    return err(`the hand register could not be read: ${register.error.message}`);
  }
  const prefix = `${MONITOR_STEP_PREFIX}${definition.prefix}-`;
  // The same fold `resync-signed-out` holds the owner's Done by: per key, whether a card is open.
  const cards = signInCardHistory({ prefix, rows: register.value.rows });
  const open = new Set([...cards].flatMap(([key, card]) => (card.open ? [key] : [])));
  // The pass's own departure line, before the "; replaced by" it appends.
  const departure = departedWhileFiring({ definition, replacedBy: [] });
  const settles = register.value.rows.flatMap((row) =>
    isSettledRow(row) && row.id.startsWith(prefix)
      ? [
          {
            departed: row.did.startsWith(departure),
            key: occurrenceBase({ id: row.id }).slice(prefix.length),
          },
        ]
      : [],
  );
  return ok({ dismissed: dismissedKeys({ open, settles }), open, shown: shownKeys({ open, settles }) });
}

/**
 * The opening of every settle line a pass writes itself, never the owner's — bare, and behind the wrapper a departure
 * gains when the owner had snoozed its note or pressed Later on it first: the set still left on its own.
 *
 * @param definition the monitor whose cleared and departure lines are built
 * @returns every opening {@link closedByOwner} reads as the pass's, not the owner's
 */
export function passSettleOpenings({ definition }: { definition: MonitorDefinition }): readonly string[] {
  const bare = [
    clearedBy({ definition }),
    departedWhileFiring({ definition, replacedBy: [] }),
    steeredBy({ steers: [] }),
    SUPERSEDED_SETTLE_OPENING,
  ];
  const wrapped = Object.values(PUT_DOWN_SETTLE_OPENINGS).flatMap((wrapper) =>
    bare.map((opening) => `${wrapper}${opening}`),
  );
  return [...bare, ...wrapped];
}

/**
 * Every key whose LAST settle was the owner's Done, mapped to when, with no card for it open.
 *
 * Narrower than {@link dismissedKeys}, which reads every settle but a departure as closed: a `recipe-stopped` set
 * that CLEARED on its own and came back is news, so the pass's own cleared, steered and
 * superseded lines are not the owner's close either — nor is one of them behind a snooze or Later wrapper, which the pass
 * wrote too. A posting that settles another card is a supersession, not the owner's.
 *
 * @param rows the hand register, in the order it was written
 * @param prefix the monitor's step-id prefix, `mon-<prefix>-`
 * @param passOpenings how each settle line a pass writes opens
 * @returns key → the instant the owner closed it
 */
export function closedByOwner({
  rows,
  prefix,
  passOpenings,
}: {
  rows: readonly HandRow[];
  prefix: string;
  passOpenings: readonly string[];
}): ReadonlyMap<string, string> {
  const open = new Set<string>();
  const last = new Map<string, { byOwner: boolean; iso: string }>();
  for (const row of rows) {
    if (isSettledRow(row)) {
      if (row.id.startsWith(prefix)) {
        open.delete(row.id);
        const byOwner = !passOpenings.some((opening) => row.did.startsWith(opening));
        last.set(occurrenceBase({ id: row.id }).slice(prefix.length), { byOwner, iso: row.settledIso });
      }
      continue;
    }
    if (row.step.id.startsWith(prefix)) {
      open.add(row.step.id);
    }
    if (row.settles?.id.startsWith(prefix) === true) {
      open.delete(row.settles.id);
      last.set(occurrenceBase({ id: row.settles.id }).slice(prefix.length), {
        byOwner: false,
        iso: row.settles.settledIso,
      });
    }
  }
  const openKeys = new Set([...open].map((id) => occurrenceBase({ id }).slice(prefix.length)));
  return new Map(
    [...last].flatMap(([key, close]) => (close.byOwner && !openKeys.has(key) ? [[key, close.iso] as const] : [])),
  );
}

/**
 * Read which of a monitor's set keys the owner closed, and when.
 *
 * @param home the state home the hand register lives under
 * @param definition the monitor whose cards are read
 * @returns key → the instant the owner closed it, or why the register could not be read — a caller answers `unmeasurable`
 *   on that, because without the history a set the owner closed would be re-posted over their Done
 */
export function readClosedByOwner({
  home,
  definition,
}: {
  home: string;
  definition: MonitorDefinition;
}): Result<ReadonlyMap<string, string>, string> {
  const register = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (register.isErr()) {
    return err(`the hand register could not be read: ${register.error.message}`);
  }
  return ok(
    closedByOwner({
      passOpenings: passSettleOpenings({ definition }),
      prefix: `${MONITOR_STEP_PREFIX}${definition.prefix}-`,
      rows: register.value.rows,
    }),
  );
}
