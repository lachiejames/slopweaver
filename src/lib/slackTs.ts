/**
 * The one place a Slack `ts` becomes an instant.
 *
 * ## Why this is a module rather than three one-liners
 *
 * A Slack `ts` is two things at once — the message's IDENTITY (`1788220579.306599` is what
 * `conversations.replies` and every permalink are keyed on) and the instant it was posted. Reading the
 * second off the first is arithmetic nobody can do in their head, and that is exactly what kept happening:
 * MEASURED, a run hand-converted `1788220579.306599` to an instant 80 minutes later than the true one
 * (**80 minutes out**) and the wrong instant then propagated into a board row, two
 * cron schedules, a doc's status summary and two supervisors' deadman deadlines before anything noticed. The
 * announcement those deadlines governed went out 53 minutes late. Reproduce the true value with
 * `slopweaver slack when 1788220579.306599`.
 *
 * Three separate copies of this conversion already existed in the tree (`corpus/slack/shape.ts`,
 * `corpus/slack/curated.ts`, `live/listen/recover.ts`), two returning `""` on a bad input and one returning
 * `undefined`. So the code half of the same defect was live too: no single function to point a rule at, and
 * therefore no gate that could name one. The `epoch-arithmetic` gate in `yarn lint` now bans the ad-hoc
 * shape (`new Date(x * 1000)`) outside this module and {@link ../lib/date.ts}, which is what makes "derive
 * it, never convert it by hand" enforceable rather than advisory.
 *
 * ## The resolution this deliberately loses
 *
 * {@link slackTsToIso} floors to whole SECONDS, matching all three implementations it replaced and every
 * `tsIso` already written into the corpus. That is not a rounding oversight: the sub-second digits are
 * Slack's disambiguator within one second, they carry no information a reader of an instant wants, and
 * emitting them would rewrite every existing record's `tsIso` for nothing. The exact `ts` is always carried
 * ALONGSIDE the derived instant, never replaced by it — the identity stays lossless where it matters.
 *
 * Pure: no clock, no filesystem, no network.
 */

import { epochSecondsToIso } from "./date.js";

/** Slack's fractional part is always exactly six digits — see `live/slack/permalink.ts`'s module header. */
const SLACK_TS_FRACTION_DIGITS = 6;

/** A `ts` as Slack returns it: whole seconds, optionally `.` plus its six-digit disambiguator. */
const SLACK_TS = /^(\d+)(?:\.(\d+))?$/;

/** `p` + at least seconds-plus-fraction digits, the form a permalink path segment carries. */
const PERMALINK_TS_SEGMENT = /p(\d{7,})/;

/**
 * Whether `ts` is shaped like a Slack timestamp at all.
 *
 * @param ts the candidate
 * @returns true for whole seconds with an optional fractional part, false for anything else
 */
export function isSlackTs({ ts }: { ts: string }): boolean {
  return SLACK_TS.test(ts);
}

/**
 * A Slack `ts` → its instant, floored to whole seconds.
 *
 * NEVER do this conversion by hand or in prose: an instant a human derived from an epoch is wrong often
 * enough that this repo has a gate about it (see the module header).
 *
 * @param ts the Slack timestamp
 * @returns the ISO-8601 instant, or `undefined` when `ts` is not a Slack timestamp
 */
export function slackTsToIso({ ts }: { ts: string }): string | undefined {
  const seconds = SLACK_TS.exec(ts)?.[1];
  return seconds === undefined ? undefined : epochSecondsToIso({ seconds: Number(seconds) });
}

/**
 * A Slack `ts` → milliseconds since the epoch, fractional digits included.
 *
 * Distinct from {@link slackTsToIso} on purpose: an ORDERING comparison wants every digit Slack gave it,
 * whereas an instant a person reads does not.
 *
 * @param ts the Slack timestamp
 * @returns epoch milliseconds, or `undefined` when `ts` is not a Slack timestamp
 */
export function slackTsToEpochMs({ ts }: { ts: string }): number | undefined {
  return isSlackTs({ ts }) ? Math.round(Number.parseFloat(ts) * 1000) : undefined;
}

/**
 * Milliseconds since the epoch → the Slack `ts` naming that instant — the inverse of
 * {@link slackTsToEpochMs}, for the `oldest`/`latest` bounds Slack's history methods take.
 *
 * @param ms epoch milliseconds
 * @returns a Slack-shaped timestamp with the full six fractional digits
 */
export function slackTsFromEpochMs({ ms }: { ms: number }): string {
  const seconds = Math.floor(ms / 1000);
  const millis = ms - seconds * 1000;
  const fraction = String(millis * 1000).padStart(SLACK_TS_FRACTION_DIGITS, "0");
  return `${String(seconds)}.${fraction}`;
}

/**
 * The `ts` a Slack permalink's path segment encodes — `p1788220579306599` → `1788220579.306599`.
 *
 * The dot goes back before the LAST SIX digits, because Slack strips it rather than the fraction. Accepts a
 * whole permalink or the bare segment, so a pasted link needs no pre-parsing to be turned into an instant.
 *
 * @param permalink a Slack archive permalink, or its bare `p…` timestamp segment
 * @returns the Slack timestamp, or `undefined` when no `p…` segment is present
 */
export function slackTsFromPermalink({ permalink }: { permalink: string }): string | undefined {
  const digits = PERMALINK_TS_SEGMENT.exec(permalink)?.[1];
  if (digits === undefined) {
    return undefined;
  }
  const cut = digits.length - SLACK_TS_FRACTION_DIGITS;
  return `${digits.slice(0, cut)}.${digits.slice(cut)}`;
}
