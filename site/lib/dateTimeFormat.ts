/**
 * One `Intl.DateTimeFormat` per locale and options, built once and kept for the page's life: every date the console
 * words goes through {@link dateTimeFormatOf}, never through `new Intl.DateTimeFormat` at the call.
 *
 * Why it is a rule, measured on the desktop app's voice overlay (Electron 44.5.1): each construction
 * clones an ICU `SimpleDateFormat` and its `DecimalFormat`, and PartitionAlloc never hands those regions back. The
 * stage's history drew about five per earlier turn on every render, 5,460 per render over 200 turns, and a call
 * re-renders it on every transcript delta — so the overlay's renderer ran out of regions (`OnNoMemoryInternal`,
 * oom.cc:85, about 259,000 Tag-14 regions) inside two minutes of every call.
 * Replaying that churn at ten renders a second took 11,294 regions to 239,588 in 35 seconds, and none came back.
 * Repro: `vmmap --summary <overlay renderer pid>`, the `App-Specific Tag 14` row, read during a call before and
 * after this module.
 */

const formats = new Map<string, Intl.DateTimeFormat>();

/**
 * The formatter for a locale and options, the same instance every time the pair is asked for again: options are keyed
 * by their defined entries in name order, so `{ hour, minute }` and `{ minute, hour }` share one.
 *
 * @param locale the BCP 47 tag, or `undefined` for the reader's own
 * @param options what to show and in which time zone, as `Intl.DateTimeFormat` takes them
 * @returns the formatter; an invalid locale or option throws as the constructor does, a programming error
 */
export function dateTimeFormatOf({
  locale,
  options,
}: {
  locale: string | undefined;
  options: Intl.DateTimeFormatOptions;
}): Intl.DateTimeFormat {
  const entries = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .toSorted(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify([locale, entries]);
  const held = formats.get(key);
  if (held !== undefined) {
    return held;
  }
  const made = new Intl.DateTimeFormat(locale, options);
  formats.set(key, made);
  return made;
}

/**
 * The reader's time zone, read off the page's one default formatter: asking `new Intl.DateTimeFormat()` for it is a
 * construction like any other, and a list asking once per row is the same churn. A Mac that changes zone shows it at
 * the page's next load.
 *
 * @returns the IANA zone, e.g. `Australia/Sydney`
 */
export function readerTimeZone(): string {
  return dateTimeFormatOf({ locale: undefined, options: {} }).resolvedOptions().timeZone;
}
