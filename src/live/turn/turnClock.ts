/**
 * The TURN's own clock on the live card — `still working, 23m` — and its inverse, in one leaf module.
 *
 * Measured (`src/__tests__/fixtures/replay/inline-turn-silent-card-19sep`): the owner replied
 * "yo" under a bot digest, the turn ran inline for fifty minutes with two review rounds, and the owner
 * read a card that had never moved. Every `now:` line said what
 * the worker or the reviewer was doing this minute, and none said how long the OWNER had been waiting, which is
 * the one fact that tells a slow turn from a dead one.
 *
 * The grammar and its inverse live together so the renderer and the staleness probe cannot drift, and this
 * file imports nothing because `./progressLog.ts` needs the inverse while `./progressCard.ts` already
 * imports from `./progressLog.ts` — anywhere else is an import cycle.
 */

/** One elapsed reading, as `elapsedWords` or {@link turnClockText} spell it. */
const DURATION = String.raw`(?:\d+h \d+m|\d+m|under a minute|just now)`;

/** The clock's grammar, and nothing else: `withoutTurnClock` must match exactly what the two renderers write. */
const TURN_CLOCK = new RegExp(
  `still working, ${DURATION}|asked ${DURATION} ago, (?:nothing new for ${DURATION}|no activity visible)`,
);

/**
 * The clock's words for one elapsed reading.
 *
 * @param elapsed the reading `elapsedWords` gave — `just now`, `23m`, `1h 12m`
 * @returns e.g. `still working, 23m`, or `still working, under a minute` for `just now`
 */
export function turnClockText({ elapsed }: { elapsed: string }): string {
  if (elapsed === "just now") {
    return "still working, under a minute";
  }
  return `still working, ${elapsed}`;
}

/**
 * The clock once the session has gone quiet past the bound the ticker's own reap uses — the wait, and how long
 * nothing has moved, and never `still working`, which a stalled or dead turn cannot honestly claim. It is also
 * the line a reaped ticker leaves standing, since the tick before a reap renders it.
 *
 * @param waited how long ago the ask was made, as `elapsedWords` spells it
 * @param quiet how long since the session's last tool call, or `undefined` when none is visible at all
 * @returns e.g. `asked 45m ago, nothing new for 31m` or `asked 45m ago, no activity visible`
 */
export function quietClockText({ quiet, waited }: { quiet: string | undefined; waited: string }): string {
  if (quiet === undefined) {
    return `asked ${waited} ago, no activity visible`;
  }
  return `asked ${waited} ago, nothing new for ${quiet}`;
}

/**
 * A card detail with its turn clock reduced to `still working` — what the staleness probe compares, because
 * a clock derived from the ask's own timestamp moves every minute whether or not the worker did anything.
 *
 * @param detail one recorded card detail, possibly prefixed (`warn raised — …`)
 * @returns the detail with the clock's elapsed readings removed, or the detail byte-identical when it has none
 */
export function withoutTurnClock({ detail }: { detail: string }): string {
  return detail.replace(TURN_CLOCK, (clock) => (clock.startsWith("asked") ? "asked, quiet" : "still working"));
}
