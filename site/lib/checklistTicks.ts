/**
 * Which lines of a hand step's checklist the owner has ticked, kept in their browser between visits — pure, so the tick
 * arithmetic is tested without a browser.
 *
 * The checklist reads like a script to run through in one's head, with instructions to check off as they go. A tick
 * is the owner's own progress mark and settles nothing: the step
 * leaves the queue only when its witness runs, so the ticks live in `localStorage` and never in the register.
 */

/** The `localStorage` key prefix one step's ticks live under. */
const TICKS_PREFIX = "sw-checklist:";

/**
 * The key one step's ticks live under — the step's own id, so two steps never share ticks.
 *
 * @returns the `localStorage` key
 */
export function ticksKey({ subject }: { subject: string }): string {
  return `${TICKS_PREFIX}${subject}`;
}

/**
 * The ticked line numbers a stored value names, keeping only lines the checklist has.
 *
 * @param stored the stored value, comma-separated line indexes from zero
 * @param count how many lines the checklist carries
 * @returns the ticked indexes
 */
export function tickedLines({ stored, count }: { stored: string; count: number }): ReadonlySet<number> {
  const ticked = new Set<number>();
  for (const part of stored.split(",")) {
    const index = Number.parseInt(part, 10);
    if (Number.isInteger(index) && index >= 0 && index < count && String(index) === part.trim()) {
      ticked.add(index);
    }
  }
  return ticked;
}

/**
 * The stored value after one line is ticked or unticked.
 *
 * @param stored the ticked line numbers, comma-joined, as the preference holds them
 * @param count how many lines the checklist carries
 * @param index the line the owner clicked, from zero
 * @returns the value to store, ascending
 */
export function toggledTicks({ stored, count, index }: { stored: string; count: number; index: number }): string {
  const ticked = new Set(tickedLines({ count, stored }));
  if (ticked.has(index)) {
    ticked.delete(index);
  } else {
    ticked.add(index);
  }
  return [...ticked].toSorted((a, b) => a - b).join(",");
}

/**
 * Whether a stored value is a tick list this reader accepts — any string, since {@link tickedLines} drops what it
 * cannot read rather than refusing the whole list.
 *
 * @returns true for a string
 */
export function isTickList(value: unknown): value is string {
  return typeof value === "string";
}
