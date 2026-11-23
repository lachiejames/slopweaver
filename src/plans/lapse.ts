/**
 * The one wording for when a plan's paid subscription lapses, shared by `plans list` and every `PLAN` line
 * `claude gauge` prints, so the two surfaces a reader compares can never word the same fact two ways.
 *
 * The stored instant is printed as recorded, with no clock consulted: a lapse is informational, so a date in the
 * past changes no wording, pause, probe or route. An absent one says UNRECORDED rather than vanishing, because a
 * plan whose end nobody wrote down is exactly the plan a briefing must not read as open-ended.
 *
 * Where the provider itself states the paid period's end — a Codex store's sign-in does, `../codex/subscriptionDates.ts`
 * — `plans list` passes that reading in and it prints beside, never inside, the recorded clause.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

/**
 * What is wrong with one row's `lapsesAtIso`, for the register and the Claude accounts file alike.
 *
 * @param at how the refusal names the row
 * @param lapsesAtIso the raw value the row carries
 * @returns one problem when a present value is not a strict ISO-8601 instant, otherwise none
 */
export function lapseProblems({ at, lapsesAtIso }: { at: string; lapsesAtIso: unknown }): readonly string[] {
  if (lapsesAtIso === undefined) {
    return [];
  }
  if (typeof lapsesAtIso === "string" && parseStrictIsoInstantMs({ text: lapsesAtIso }) !== undefined) {
    return [];
  }
  return [`${at}'s \`lapsesAtIso\`, when present, must be an ISO-8601 instant`];
}

/**
 * What the provider itself states about a plan's paid period, when a reader asked it.
 *
 * `stated` is the provider's own end-of-paid-period instant and when the provider last checked it; `unread` is a
 * provider that can state one and, for this store, did not, with a short reason that names no credential. Only Codex
 * stores carry a reading: Anthropic states no renewal, period-end or cancel date over any interface this machine uses
 * (measured on `GET /api/oauth/profile` and `/api/oauth/usage`), so a Claude plan's lapse is recorded or nothing.
 */
export type PlanPaidThrough =
  | { readonly kind: "stated"; readonly paidThroughIso: string; readonly lastCheckedIso: string }
  | { readonly kind: "unread"; readonly reason: string };

/**
 * The recorded clause alone: `lapses <iso>`, or `lapse UNRECORDED`.
 *
 * @param lapsesAtIso the recorded instant
 * @returns the clause
 */
function recordedClause({ lapsesAtIso }: { lapsesAtIso: string | undefined }): string {
  if (lapsesAtIso === undefined) {
    return "lapse UNRECORDED";
  }
  return `lapses ${lapsesAtIso}`;
}

/**
 * An ISO instant split around its fractional seconds, which `Date.parse` would truncate to milliseconds. Anchored on
 * the fixed shape (`YYYY-MM-DDTHH:MM:SS`, any fraction digits, then `Z` or `±HH:MM`), so every group is bounded by a
 * character the next cannot match and the match is linear.
 */
const FRACTION = /^(?<head>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(?<digits>\d+))?(?<tail>Z|[+-]\d{2}:\d{2})$/u;

/**
 * One instant as a key that compares at full precision: whole milliseconds since the epoch, then every fractional
 * digit, padded so `.123` and `.123000` agree.
 *
 * @param iso the instant as written
 * @returns the key, or undefined when the text is not one ISO instant
 */
function fullPrecisionKey({ iso }: { iso: string }): string | undefined {
  const groups = FRACTION.exec(iso)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const wholeMs = Date.parse(`${groups["head"]!}${groups["tail"]!}`);
  if (Number.isNaN(wholeMs)) {
    return undefined;
  }
  let digits = "";
  if (groups["digits"] !== undefined) {
    digits = groups["digits"];
  }
  return `${String(wholeMs)}.${digits.padEnd(12, "0")}`;
}

/**
 * Whether two ISO instants name the same instant at their FULL precision. A provider claim carries six fractional
 * digits and `Date.parse` keeps three, so comparing parsed milliseconds alone would read two instants 456
 * microseconds apart as one and drop the recorded one. Offsets are whole minutes, so the fraction compares on its own.
 *
 * @param left one instant
 * @param right the other
 * @returns true only when both parse and agree to the last fractional digit
 */
function sameInstant({ left, right }: { left: string; right: string }): boolean {
  const leftKey = fullPrecisionKey({ iso: left });
  return leftKey !== undefined && leftKey === fullPrecisionKey({ iso: right });
}

/**
 * The lapse clause for one plan.
 *
 * With no provider reading it is the recorded clause alone: `lapses <iso>` when `plans lapse` wrote one down,
 * `lapse UNRECORDED` when nobody did. A provider-STATED date is a different fact from an owner-RECORDED lapse, so the
 * two are never merged into one word: a stated date prints as `paid through <iso> (provider-stated, checked <iso>)`
 * and wins the line, and a recorded lapse beside it prints only when it names a DIFFERENT instant, flagged
 * `DIFFERS`, because two sources disagreeing is the thing a reader must see. A reading that failed says
 * `paid through UNREAD (<reason>)` and keeps the recorded clause, so a broken read never hides what was recorded.
 *
 * @param lapsesAtIso the instant the plan's paid subscription ends, as `plans lapse` recorded it
 * @param paidThrough what the provider states, when a reader asked it
 * @returns the clause, with no leading separator
 */
export function renderPlanLapse({
  lapsesAtIso,
  paidThrough,
}: {
  lapsesAtIso?: string | undefined;
  paidThrough?: PlanPaidThrough | undefined;
}): string {
  if (paidThrough === undefined) {
    return recordedClause({ lapsesAtIso });
  }
  if (paidThrough.kind === "unread") {
    return `paid through UNREAD (${paidThrough.reason}) · ${recordedClause({ lapsesAtIso })}`;
  }
  const stated = `paid through ${paidThrough.paidThroughIso} (provider-stated, checked ${paidThrough.lastCheckedIso})`;
  if (lapsesAtIso === undefined || sameInstant({ left: lapsesAtIso, right: paidThrough.paidThroughIso })) {
    return stated;
  }
  return `${stated} · lapses ${lapsesAtIso} DIFFERS`;
}
