/**
 * The observation window an alert summary is taken over — `7d`, `24h`, `90m`, `2w` — parsed and bounded.
 *
 * ## Why this is its own module, and parsed before anything else happens
 *
 * It is the one input that decides how much network the verb performs, so it is validated BEFORE a token is
 * resolved and before a single page is fetched. A typo'd window that only fails after the crawl has already
 * paged a noisy channel spends someone's rate-limit budget to learn nothing — and the CLI's `parseRejectIsIoFree`
 * meta is a claim this repo checks, not a convention.
 *
 * ## The label is the caller's own text, not a re-rendering of it
 *
 * `label` is what the caller typed (trimmed), and it becomes the form's `window`, which is rendered into the
 * TL;DR and used as the tally table's count-column header. Echoing the input rather than reconstituting it from
 * `ms` means `24h` stays `24h` instead of coming back as `1d`: the two are the same duration and are not the same
 * statement about what was looked at.
 */
import { err, ok, type Result } from "../../lib/result.js";

/** Milliseconds per unit. `w` is 7 days; there is no month, because a month is not a fixed duration. */
const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000, w: 604_800_000 } as const;

/** The units a window may be expressed in. */
type WindowUnit = keyof typeof UNIT_MS;

/**
 * Digits then one unit letter, with the digit run bounded at six.
 *
 * The bound is not decoration. The label goes into the form's `window` field, which is capped at
 * `ALERT_SUMMARY_WINDOW_MAX` (12) because it prefixes the derived TL;DR — so an unbounded digit run here would
 * let a valid-looking window build a card the form then refuses, reporting a cap the caller never saw. Six digits
 * plus a unit is seven characters, comfortably inside it, and `999999w` is already nineteen thousand years.
 */
const WINDOW_PATTERN = /^(\d{1,6})([dhmw])$/;

/** A parsed window: the caller's own text, and the duration it denotes. */
export interface AlertWindow {
  readonly label: string;
  readonly ms: number;
}

/** The usage fragment every window refusal ends with, so the caller learns the whole surface from one error. */
const WINDOW_SHAPE =
  "expected digits followed by m (minutes), h (hours), d (days) or w (weeks) — e.g. 90m, 24h, 7d, 2w";

/**
 * Parse a window string into its duration.
 *
 * @param text the raw `--window` value
 * @returns the parsed window, or a refusal naming the whole accepted shape
 */
export function parseAlertWindow({ text }: { text: string }): Result<AlertWindow> {
  const label = text.trim();
  const matched = WINDOW_PATTERN.exec(label);
  if (matched === null) {
    return err([`invalid --window ${JSON.stringify(text)}: ${WINDOW_SHAPE}`]);
  }
  // Both groups are present whenever the pattern matched — it has exactly two, neither optional — and the
  // second is constrained by the pattern's own `[dhmw]` class to exactly the keys of UNIT_MS.
  const amount = Number(matched[1]);
  // oxlint-disable-next-line no-unsafe-type-assertion
  const unit = matched[2] as WindowUnit;
  if (amount === 0) {
    return err([`invalid --window ${JSON.stringify(text)}: a window of zero reads nothing. ${WINDOW_SHAPE}`]);
  }
  return ok({ label, ms: amount * UNIT_MS[unit] });
}

/**
 * The Slack `oldest` bound for a window ending now, as the epoch-SECONDS string the API takes.
 *
 * The clock is injected rather than read, which is what keeps every caller of this testable — `nowMs` comes from
 * the CLI shell in production and from a fixed number under test, so there is no real clock in a unit test.
 *
 * @param window the parsed window
 * @param nowMs the current time in epoch milliseconds
 * @returns the `oldest` bound, in epoch seconds, as Slack's decimal string
 */
export function windowOldestTs({ window, nowMs }: { window: AlertWindow; nowMs: number }): string {
  return String(Math.max(0, Math.floor((nowMs - window.ms) / 1000)));
}
