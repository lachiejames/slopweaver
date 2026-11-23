/**
 * A scheduled card's FIRST firing — the day it opens with a few intro lines.
 *
 * A daily post landing in a team channel for the first time needs explaining: readers cannot otherwise tell whether
 * it is a standing feature that posts every day or a one-off. The intro says in a few lines that this is a trial,
 * that feedback is wanted and the post is turned off if it is useless, that it posts every day, and what the
 * purpose of this particular bot is.
 *
 * ## "First" is "no run of this row has ever succeeded"
 *
 * Not "no run record": `./definitionRunStore.ts` also stamps a firing the door REFUSED (exit 3) and one retired
 * dead after its attempts ran out (exit 1), and neither reached the channel. So the store keeps
 * `firstSucceededIso`, the first instant a run exited 0, across every later run — and a card row's run exits 0
 * only when its post went through. A record written before that field existed counts as delivered when its own
 * last run exited 0, which is every row posting on this install today, so none of them re-introduces itself.
 * The store carries that older success forward into `firstSucceededIso` on the next write, whatever it exits with.
 * The honest gaps, stated rather than discovered: a record written before the field existed whose LAST run failed
 * carries no trace of its earlier success, so that row is introduced once more; a day-one post that lands just
 * before its process dies, with no run recorded, is introduced again next firing; and a row whose channel is later edited does not re-introduce
 * itself in the new channel.
 *
 * ## The intro is derived unless the row writes its own
 *
 * A row may carry `params.intro`, one to four plain lines. Without one, {@link defaultIntro} says the four things
 * listed above, from the row's cadence alone, so a new row never goes out unintroduced and never fails
 * for want of prose. The lines are plain strings, so an intro can tag nobody — and the two card kinds a row can
 * post have no mention vocabulary at all (`outbound/artifact/alertSummary.ts`; a Datadog digest item never
 * carries an owner), which is how "day one tags nobody" holds for them by construction.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { introSchema } from "../../outbound/artifact/introAndRank.js";
import type { RecipeDefinitionRun } from "./definitionRunStore.js";
import { type RecipeError, RecipeErrors } from "./errors.js";

/** The weekday names a cron day-of-week field numbers, Sunday first as cron does. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * How often a cron cadence posts, in words a channel member reads.
 *
 * Only the shapes a posting row actually uses are named; anything else is "on a regular schedule" rather than a
 * guess, because a wrong frequency in a trial's own introduction is worse than a vague one.
 *
 * @param cadence the row's five-field cron expression
 * @returns a phrase such as `every day`, `every weekday` or `every Monday`
 */
export function cadencePhrase({ cadence }: { cadence: string }): string {
  const fields = cadence.trim().split(/\s+/);
  if (fields.length !== 5) {
    return "on a regular schedule";
  }
  const [minute = "", hour = "", dayOfMonth, month, dayOfWeek = ""] = fields;
  const fixedTime = /^\d+$/.test(minute) && /^\d+$/.test(hour);
  if (!fixedTime || dayOfMonth !== "*" || month !== "*") {
    return "on a regular schedule";
  }
  if (dayOfWeek === "*") {
    return "every day";
  }
  if (dayOfWeek === "1-5") {
    return "every weekday";
  }
  const day = /^[0-6]$/.test(dayOfWeek) ? WEEKDAYS[Number(dayOfWeek)] : undefined;
  if (day === undefined) {
    return "on a regular schedule";
  }
  return `every ${day}`;
}

/**
 * The intro a row gets when it writes none: a trial, how often, where feedback goes, and what it covers here.
 *
 * It names the CHANNEL rather than the row's label, and that is a rule rather than a phrasing choice. Every bound
 * on an intro line is also a bound on anything interpolated into one, and a label is free text: a colon in it
 * breaks a packing rule, a `SUP-123` in it is a bare reference, a URL in it is raw markup. Since an intro
 * refused at the post leg is refused at every firing, one such label would make the row unpostable forever. A
 * row that wants to name its own subject writes `params.intro`, which is checked when the row is planned.
 *
 * @param cadence the row's cron expression
 * @returns three plain lines, each well inside the intro line cap
 */
export function defaultIntro({ cadence }: { cadence: string }): readonly string[] {
  return [
    `👋 this is a trial. i will post a summary of this channel's alerts here ${cadencePhrase({ cadence })}.`,
    "it lists what fired and what needs a person, so you can see it without digging through the alerts.",
    "feedback goes in the thread. if it is not useful, it gets turned off.",
  ];
}

/** Whether any run of the row has succeeded — see this module's header for the older-record reading. */
function hasDelivered({ priorRun }: { priorRun: RecipeDefinitionRun | undefined }): boolean {
  if (priorRun === undefined) {
    return false;
  }
  return priorRun.firstSucceededIso !== undefined || priorRun.exitCode === 0;
}

/**
 * The intro this firing carries, or none when the row has delivered before.
 *
 * @param priorRun the row's run record, absent when no firing of it has ever settled
 *   (a record whose runs never succeeded still counts as a first firing)
 * @param intro the row's own intro lines, when it wrote them
 * @param cadence the row's cron expression, for the derived intro
 * @returns the lines to open the card with, or undefined on every firing after the first
 */
export function firstFiringIntro({
  priorRun,
  intro,
  cadence,
}: {
  priorRun: RecipeDefinitionRun | undefined;
  intro: readonly string[] | undefined;
  cadence: string;
}): readonly string[] | undefined {
  if (hasDelivered({ priorRun })) {
    return undefined;
  }
  if (intro !== undefined) {
    return intro;
  }
  return defaultIntro({ cadence });
}

/**
 * The read leg's `--intro` flag for this firing, or nothing.
 *
 * @param intro the lines {@link firstFiringIntro} chose
 * @returns `["--intro", <JSON array>]`, or an empty tail
 */
export function introFlagArgs({ intro }: { intro: readonly string[] | undefined }): readonly string[] {
  if (intro === undefined) {
    return [];
  }
  return ["--intro", safeJsonStringify({ label: "day-one intro lines", value: intro })];
}

/**
 * Parse a read verb's `--intro` value: a JSON array of one to four non-empty strings.
 *
 * @param value the raw flag, absent when the caller passed none
 * @returns the lines, undefined when the flag was absent, or why the value is not an intro
 */
export function parseIntroFlag({
  value,
}: {
  value: string | undefined;
}): Result<readonly string[] | undefined, RecipeError> {
  if (value === undefined) {
    return ok(undefined);
  }
  let raw: unknown;
  try {
    raw = safeJsonParse({ label: "--intro", text: value });
  } catch {
    return err(RecipeErrors.introNotJson({ got: value }));
  }
  const lines = introSchema.safeParse(raw);
  if (!lines.success) {
    return err(RecipeErrors.introInvalid({ got: value, issue: lines.error.issues[0]!.message }));
  }
  return ok(lines.data);
}
