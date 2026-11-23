/**
 * The Slack-steers chart's arithmetic: the owner's turns per kind per day of THEIR calendar, the drafts they reviewed on the same
 * days, and the one sentence each kind's small chart says about itself.
 *
 * One chart for Slack steers with a line per kind shows which feedback is
 * most frequent now and which spiked; a small chart per kind sits behind it; the owner's dated words sit behind each. The page asserts
 * nothing it could be wrong about: no threshold, no green — "nothing observed for N
 * days", and the owner's own word that a problem stopped is marked apart from the silence. The counts come from
 * `slopweaver profile steers --json` (`src/profile/steerKinds.ts`), the reviewed baseline from
 * `slopweaver slack draft corrections --json`.
 */

import type { SteerKindTrail } from "../components/live/readSlackSteers";

/** One colour per kind, identity only — never a state. Mid-lightness so each reads on the light and dark planes. */
export const KIND_COLOURS: Readonly<Record<string, string>> = {
  "em-dashes": "oklch(0.66 0.14 250)",
  length: "oklch(0.7 0.13 195)",
  place: "oklch(0.72 0.13 90)",
  proof: "oklch(0.68 0.15 60)",
  stakeholders: "oklch(0.64 0.15 310)",
  voice: "oklch(0.7 0.12 0)",
  withheld: "oklch(0.6 0.06 30)",
};

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/**
 * The calendar day an instant falls on where the owner is, `YYYY-MM-DD`.
 *
 * @param timeZone an IANA zone, the owner's browser's own
 * @returns the day key
 */
export function dayKey({ iso, timeZone }: { iso: string; timeZone: string }): string {
  return new Date(Date.parse(iso)).toLocaleDateString("en-CA", { timeZone });
}

/**
 * Every day of the window, oldest first, each named once — the x axis every chart on the page shares.
 *
 * It steps the CALENDAR, never the instant: a day on which the clocks go forward is 23 hours long, so an instant
 * stepped 24 hours from late evening lands two days on and the day between drops off the axis, its counts with it.
 *
 * @param sinceIso the window's floor
 * @param nowIso its ceiling
 * @param timeZone an IANA zone, the owner's browser's own
 * @returns the day keys; none when the floor is after the ceiling
 */
export function windowDays({
  sinceIso,
  nowIso,
  timeZone,
}: {
  sinceIso: string;
  nowIso: string;
  timeZone: string;
}): readonly string[] {
  const days: string[] = [];
  const last = dayKey({ iso: nowIso, timeZone });
  // A `YYYY-MM-DD` key read as UTC midnight steps a whole calendar day per DAY_MS, with no zone to shift it.
  for (let at = Date.parse(dayKey({ iso: sinceIso, timeZone })); ; at += DAY_MS) {
    const day = new Date(at).toISOString().slice(0, 10);
    if (day > last) {
      return days;
    }
    days.push(day);
  }
}

/**
 * How many of a list of instants fall on each day.
 *
 * @param isos the instants
 * @param days the axis
 * @param timeZone an IANA zone, the owner's browser's own
 * @returns one count per day, in axis order; an instant off the axis is not counted
 */
export function perDay({
  isos,
  days,
  timeZone,
}: {
  isos: readonly string[];
  days: readonly string[];
  timeZone: string;
}): readonly number[] {
  const at = new Map(days.map((day, index) => [day, index]));
  const counts = days.map(() => 0);
  for (const iso of isos) {
    const index = at.get(dayKey({ iso, timeZone }));
    if (index !== undefined) {
      counts[index] += 1;
    }
  }
  return counts;
}

/**
 * The days on which the owner corrected a kind — one per turn, the turn being the unit counted.
 *
 * @returns one count per day, in axis order
 */
export function correctionsPerDay({
  trail,
  days,
  timeZone,
}: {
  trail: SteerKindTrail;
  days: readonly string[];
  timeZone: string;
}): readonly number[] {
  const isos = trail.points.filter((point) => point.says === "corrects").map((point) => point.atIso);
  return perDay({ days, isos, timeZone });
}

/**
 * Day counts summed into weeks that end on the last day, oldest first — the owner reviews drafts EACH
 * WEEK, and a line per day spikes on every call they happen to make. The oldest
 * week is short when the window is not a whole number of weeks.
 *
 * @param counts one count per day, oldest first
 * @returns one count per week, oldest first
 */
export function weekly({ counts }: { counts: readonly number[] }): readonly number[] {
  const weeks: number[] = [];
  for (let end = counts.length; end > 0; end -= 7) {
    weeks.unshift(counts.slice(Math.max(0, end - 7), end).reduce((sum, one) => sum + one, 0));
  }
  return weeks;
}

/** What one kind's small chart says about itself, every clause a fact the reading holds. */
export type KindState =
  | { readonly kind: "unnamed" }
  | {
      readonly kind: "quiet";
      readonly lastIso: string;
      readonly days: number;
      readonly stoppedIso: string | undefined;
    };

/**
 * The state a kind's chart names: never corrected in the window, or when last and how long since, with the owner's word that
 * it stopped beside it when they gave one after the last correction.
 *
 * @param nowIso the instant the reading was taken
 * @returns the state
 */
export function kindState({ trail, nowIso }: { trail: SteerKindTrail; nowIso: string }): KindState {
  if (trail.lastCorrectedIso === undefined) {
    return { kind: "unnamed" };
  }
  const days = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(trail.lastCorrectedIso)) / DAY_MS));
  return { days, kind: "quiet", lastIso: trail.lastCorrectedIso, stoppedIso: trail.stoppedIso };
}

/**
 * The state as the sentence under a small chart.
 *
 * @param day how a date prints
 * @returns the sentence
 */
export function kindStateLine({ state, day }: { state: KindState; day: (args: { iso: string }) => string }): string {
  if (state.kind === "unnamed") {
    return "No turn of yours in this window names it.";
  }
  const since = `Last named ${day({ iso: state.lastIso })}; nothing observed for ${String(state.days)} ${state.days === 1 ? "day" : "days"}.`;
  if (state.stoppedIso === undefined) {
    return since;
  }
  return `${since} You said it stopped on ${day({ iso: state.stoppedIso })}.`;
}

/**
 * A polyline's points for one series on a chart of a given size: x across the days, y up from the floor.
 *
 * @param counts one value per day
 * @param top the value the chart's top edge stands for
 * @param width the chart's drawn width
 * @param height the chart's drawn height
 * @returns the SVG `points` attribute
 */
export function linePoints({
  counts,
  top,
  width,
  height,
}: {
  counts: readonly number[];
  top: number;
  width: number;
  height: number;
}): string {
  const step = counts.length > 1 ? width / (counts.length - 1) : 0;
  const scale = top > 0 ? height / top : 0;
  return counts.map((count, at) => `${(at * step).toFixed(1)},${(height - count * scale).toFixed(1)}`).join(" ");
}
