/**
 * How stale a reading is, in words a glance can read.
 *
 * The hours and days rungs are not decoration. The console's own tiles are minutes old at worst, but the
 * Queue ages a hand step and an autonomy act, and one of the steps open on this machine has been
 * waiting 14.8 days — which a minutes-only scale renders as "21312m ago", a number nobody converts. A
 * scale that runs out is a scale that stops being read.
 *
 * An instant this cannot parse is NAMED rather than arithmetic'd. `new Date("2026-09-14T01:1xZ").getTime()`
 * is `NaN`, every comparison against it is false, and the last rung would print `NaNd ago` — a value the
 * page never measured, drawn exactly where a measured age goes. That is not a hypothetical shape: the
 * autonomy ledger can carry a hand-appended row with that very instant.
 *
 * @param iso when the value was true of the machine
 * @returns a short age, `just now` inside the first ten seconds, or a stated refusal to read the instant
 */
export function ageOf({ iso }: { iso: string }): string {
  return ageAt({ iso, nowMs: Date.now() });
}

/**
 * {@link ageOf} against a clock the caller already read, so two labels on one render share one instant.
 *
 * @param nowMs the clock the age is measured to
 * @returns the same short age, measured to `nowMs`
 */
export function ageAt({ iso, nowMs }: { iso: string; nowMs: number }): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) {
    return "instant unreadable";
  }
  const seconds = Math.max(0, Math.round((nowMs - at) / 1000));
  if (seconds < 10) {
    return "just now";
  }
  if (seconds < 90) {
    return `${String(seconds)}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return `${String(minutes)}m ago`;
  }
  const hours = seconds / 3600;
  if (hours < 36) {
    return `${hours.toFixed(1)}h ago`;
  }
  return `${(hours / 24).toFixed(1)}d ago`;
}
