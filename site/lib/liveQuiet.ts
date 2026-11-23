/**
 * The console's fast lane goes quiet while the owner is on a voice call — pure, so the hold and the catch-up are
 * unit tests.
 *
 * The slow part of a call is capturing the owner's screen, which took twenty to thirty seconds against a target of
 * five to ten. A recording of such a call (`localhost.har`) put a share of it on the console's own polls: six
 * fast-lane verbs fire together every twenty seconds, and the two screen relays in it queued behind them in
 * the browser for 1.0s and 4.1s (`timings.blocked` — six requests already hold every connection the browser
 * allows one origin) before the route even saw them, then shared the machine with six freshly spawned CLIs.
 * The polls in flight beside a relay took 13–17s against 3–6s beside nothing.
 *
 * So from the moment a call starts connecting until it ends, a timer tick is HELD, not run, and the channel it
 * was for is remembered. The hang-up releases the hold and every held channel reads once, spaced a beat apart
 * so the catch-up is not the same burst, and nothing on screen stays a call's length behind. What is never held: a channel's first read on subscribe, and a press's supersede — a read the owner caused
 * is one they are waiting for. The trade, named: a hands or drafts badge does not move during a call. The residue,
 * named: a read already in flight when the call starts, or a channel's first read, still shares the machine.
 *
 * A call is not the only holder: a hidden tab holds the same gate until it is shown again, then catches up at once
 * rather than spaced, because the live-read slots (`liveSlots.ts`) already bound that burst (`useLive.ts`).
 */

/** The hold, shared by every channel on the page. */
export interface QuietGate {
  /** How many holders are live; the gate is quiet while this is above zero. */
  holds: number;
  /** The channel keys whose tick was held, read once when the last holder lets go. */
  readonly held: Set<string>;
}

/**
 * A gate nobody holds.
 *
 * @returns a fresh, open gate
 */
export function openQuietGate(): QuietGate {
  return { held: new Set(), holds: 0 };
}

/**
 * Whether a timer tick for one channel runs now. A tick asked while the gate is held is remembered instead.
 *
 * @param gate the page's gate
 * @param key the channel the tick is for
 * @returns true to run the read now, false when it was held for the release
 */
export function tickRuns({ gate, key }: { gate: QuietGate; key: string }): boolean {
  if (gate.holds === 0) {
    return true;
  }
  gate.held.add(key);
  return false;
}

/**
 * Take the hold. The returned release is idempotent, so an effect cleanup that runs twice lets go once.
 *
 * @param gate the page's gate
 * @returns the release, which answers the channel keys to read now — empty until the LAST holder lets go
 */
export function holdQuiet({ gate }: { gate: QuietGate }): () => readonly string[] {
  gate.holds += 1;
  let released = false;
  return () => {
    if (released) {
      return [];
    }
    released = true;
    gate.holds -= 1;
    if (gate.holds > 0) {
      return [];
    }
    const due = [...gate.held];
    gate.held.clear();
    return due;
  };
}
