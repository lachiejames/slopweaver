/**
 * A staleness interval written the way a cadence is actually spoken — `30m`, `4h`, `7d`.
 *
 * `refresh --if-stale` shipped with `--stale-after-days N` taking a positive INTEGER, which made one day the
 * shortest interval anyone could ask for. That was fine while the flag existed to catch a source that had
 * gone dark for a week, and wrong the moment it became the knob a scheduled tick turns: the owner's ruling
 * puts the fast sources on "a shorter cadence", and an hourly slot cannot say "one hour" in days
 * without writing `0.042`.
 *
 * A unit suffix rather than a fractional day, because the caller is a cron-shaped line a person reads: `4h`
 * says what it means and `0.167` does not. A BARE number is refused rather than assumed to be days — the
 * flag it replaces meant days, so silently reading `4` as four days would turn an intended four-HOUR tick
 * into a four-day one, which is exactly the direction that fails quietly.
 */

/** Milliseconds per unit, and the units a duration may name. */
const UNIT_MS: Readonly<Record<string, number>> = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
};

/** The literal pattern: a positive number, then exactly one unit letter. */
const DURATION = /^([0-9]+(?:\.[0-9]+)?)(m|h|d)$/;

/**
 * Parse a duration like `30m`, `4h` or `7d` into milliseconds. Pure.
 *
 * @param value the raw flag value
 * @returns the duration in milliseconds, or the reason it was rejected
 */
export function parseDuration({ value }: { value: string }): { ms: number } | { error: string } {
  const match = DURATION.exec(value.trim());
  if (match === null) {
    return {
      error: `must be a duration with a unit — \`30m\`, \`4h\` or \`7d\` — got \`${value}\`. A bare number is refused rather than guessed at.`,
    };
  }
  // Both captures exist whenever the pattern matched — the groups are not optional — so an assertion here is
  // the honest spelling. Coalescing to a lookup that would silently miss is how a `4h` becomes a `0`.
  const amount = Number(match[1]!);
  const unit = UNIT_MS[match[2]!]!;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: `must be a positive duration — got \`${value}\`` };
  }
  return { ms: amount * unit };
}

/**
 * Render a duration in milliseconds back as the shortest exact unit it divides into. Pure.
 *
 * Used for the verdict line each source prints, so what a caller typed is what it reads back — a tick asked
 * for in hours should not report itself in fractional days.
 *
 * @param ms the duration in milliseconds
 * @returns the duration written with its largest exactly-dividing unit
 */
export function renderDuration({ ms }: { ms: number }): string {
  for (const unit of ["d", "h", "m"] as const) {
    const size = UNIT_MS[unit]!;
    if (ms % size === 0) {
      return `${String(ms / size)}${unit}`;
    }
  }
  return `${String(Math.round(ms / UNIT_MS["m"]!))}m`;
}

/**
 * Render an elapsed span the way a person reads an age — `45m`, `3.2h`, `11.8d`.
 *
 * Deliberately NOT {@link renderDuration}. That one picks the largest unit dividing EXACTLY, which is right
 * for echoing back the threshold a caller typed and wrong for an arbitrary age: a cursor 1,924 minutes old
 * divides exactly into no larger unit, so the exact renderer calls it `1924m` when a reader wants `1.3d`.
 * One decimal, and the largest unit the span reaches.
 *
 * @param ms the elapsed span in milliseconds
 * @returns the span written in its largest reached unit, to one decimal
 */
export function renderAge({ ms }: { ms: number }): string {
  for (const unit of ["d", "h"] as const) {
    const size = UNIT_MS[unit]!;
    if (ms >= size) {
      return `${(ms / size).toFixed(1)}${unit}`;
    }
  }
  return `${(ms / UNIT_MS["m"]!).toFixed(1)}m`;
}
