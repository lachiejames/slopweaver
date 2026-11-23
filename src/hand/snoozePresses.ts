/**
 * THE OWNER'S SNOOZE PRESSES, RECORDED — the reconcile's snooze arm: each `<id>.snooze-<choice>` marker becomes a record
 * in the snooze store (`./snoozeStore.ts`) with its wake instant, and the store sheds every record whose step is no
 * longer open. `./reconcile.ts` removes the markers this hands back as consumed, after its append has landed.
 */
import { readFileSync } from "node:fs";

import type { HandStepError } from "./errors.js";
import type { NoteMarker } from "./note/markers.js";
import { snoozeUntil } from "./snooze.js";
import { pruneSnoozes, recordSnooze, type SnoozeRecord, snoozeOf } from "./snoozeStore.js";

/**
 * The stamp a marker carries, trimmed. An unreadable marker reads as empty, which `snoozeUntil` refuses by name.
 *
 * @param path the marker file
 * @returns the stamp text
 */
function markerStamp({ path }: { path: string }): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

/** One snooze press read off disk: its marker, and the record it would write. */
interface Press {
  readonly marker: NoteMarker;
  readonly record: SnoozeRecord;
}

/**
 * Read every snooze marker into the record it would write, grouped by step. A press whose instant will not read
 * has no record: it is reported and handed back to be consumed, so the step comes BACK to the owner's screen.
 *
 * @param snoozes the markers this pass reads; any that is not a snooze is passed over
 * @returns each step's presses, every unreadable press, and why each would not read
 */
function readPresses({ snoozes }: { snoozes: readonly NoteMarker[] }): {
  byId: ReadonlyMap<string, readonly Press[]>;
  unreadable: readonly NoteMarker[];
  problems: readonly HandStepError[];
} {
  const byId = new Map<string, Press[]>();
  const unreadable: NoteMarker[] = [];
  const problems: HandStepError[] = [];
  for (const marker of snoozes) {
    if (marker.answer !== "snooze") {
      continue;
    }
    const pressedIso = markerStamp({ path: marker.path });
    const until = snoozeUntil({ choice: marker.choice, id: marker.id, pressedIso });
    if (until.isErr()) {
      problems.push(until.error);
      unreadable.push(marker);
      continue;
    }
    const press = { marker, record: { choice: marker.choice, id: marker.id, pressedIso, untilIso: until.value } };
    const group = byId.get(marker.id);
    if (group === undefined) {
      byId.set(marker.id, [press]);
    } else {
      group.push(press);
    }
  }
  return { byId, problems, unreadable };
}

/**
 * Whether the store already holds a press at or after this one, so writing it would roll the owner's answer back.
 *
 * @param home the state home whose snooze store is read
 * @param record the newest press read off disk
 * @returns true when the stored record stands
 */
function storedIsNewer({ home, record }: { home: string; record: SnoozeRecord }): boolean {
  const stored = snoozeOf({ home, id: record.id });
  return (
    stored.isOk() && stored.value !== undefined && Date.parse(stored.value.pressedIso) >= Date.parse(record.pressedIso)
  );
}

/**
 * Every snooze press still waiting on a reconcile, as the record it would write, read without writing — so a reader
 * that settles nothing judges an unreconciled press by the same wake instant. A press whose instant will not read
 * is left out: the reconcile consumes it and the step comes back to the owner's screen.
 *
 * @param snoozes the markers to read; any that is not a snooze is passed over
 * @returns one record per readable press
 */
export function pendingSnoozeRecords({ snoozes }: { snoozes: readonly NoteMarker[] }): readonly SnoozeRecord[] {
  return [...readPresses({ snoozes }).byId.values()].flat().map((press) => press.record);
}

/**
 * Record each snooze pressed on an open step, then, on a register that read whole, drop every record whose step
 * is no longer open.
 *
 * The press instant is the marker's own bytes, the ISO stamp the note (or `hand snooze`) wrote at the press, so a
 * reconcile running an hour late still wakes the step an hour after the owner pressed, not an hour after it ran.
 *
 * @param home the state home whose snooze store is written
 * @param snoozes the markers this pass reads; any that is not a snooze is passed over
 * @param open every step id the register carries open
 * @param prune whether the register read with no skipped line
 * @returns the records written, the markers to consume, and each failure met
 */
export function recordSnoozePresses({
  home,
  snoozes,
  open,
  prune,
}: {
  home: string;
  snoozes: readonly NoteMarker[];
  open: ReadonlySet<string>;
  prune: boolean;
}): { snoozed: readonly SnoozeRecord[]; consumed: readonly NoteMarker[]; problems: readonly HandStepError[] } {
  const read = readPresses({ snoozes });
  const snoozed: SnoozeRecord[] = [];
  const consumed: NoteMarker[] = [...read.unreadable];
  const problems: HandStepError[] = [...read.problems];
  // One step can carry several presses at once — an older one a store failure kept, a newer one `hand snooze`
  // wrote beside its record — and the directory lists them in no order that means anything. The owner's LATEST press is
  // the one that stands, so each step's presses are read together and only the newest is written.
  for (const presses of read.byId.values()) {
    const newest = presses.toSorted((a, b) => Date.parse(b.record.pressedIso) - Date.parse(a.record.pressedIso))[0]!;
    if (!storedIsNewer({ home, record: newest.record })) {
      const written = recordSnooze({ home, record: newest.record });
      if (written.isErr()) {
        problems.push(written.error);
        continue;
      }
      snoozed.push(newest.record);
    }
    for (const { marker } of presses) {
      consumed.push(marker);
    }
  }
  const pruned = prune && problems.length === 0 ? pruneSnoozes({ home, open }) : [];
  return { consumed, problems: [...problems, ...pruned], snoozed };
}
