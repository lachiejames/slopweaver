/**
 * The Fleet page's history of its own state: each supervisor tick `fleet history` recorded, judged by the same
 * `fleetVerdictOf` the badge above it reads, then collapsed into spans of one state and one cause.
 *
 * Collapsed by KIND and CAUSE rather than by the whole sentence, because the load and the working count move from
 * tick to tick: forty minutes of "holding — machine busy, on cpu" is one span whether load read 26.6 or 25.9.
 *
 * A tick from before the supervisor recorded the open-ready count cannot tell "picking up more" from "nothing ready",
 * so where the judgement would say "picking up more" it says not measured and names that — never a guess. Pure; the
 * reader is `components/live/readFleetHistory.ts`.
 */
import { fleetVerdictOf, type GlanceCapacity, type SeatCeiling } from "./fleetGlance";
import { FLEET_BADGES, type FleetStateKind, fleetStateKindOf } from "./fleetState";

/** What one tick recorded of the machine and the plans, or why it recorded nothing. */
export type HistoryCapacity =
  | {
      readonly kind: "read";
      readonly capacity: GlanceCapacity;
      readonly ceiling: SeatCeiling | undefined;
      /** When the tick read the machine and the plans — the instant the week's pace is judged at, as the badge's is. */
      readonly observedAtIso: string;
    }
  | { readonly kind: "unavailable"; readonly why: string };

/** How many sessions were working, or why the fleet was not read. */
export type HistoryWorking =
  { readonly kind: "read"; readonly working: number } | { readonly kind: "unavailable"; readonly why: string };

/** How many ready rows had nobody on them, or why that was not recorded. */
export type HistoryReady =
  { readonly kind: "read"; readonly openReadyCount: number } | { readonly kind: "not-recorded"; readonly why: string };

/** One tick's facts, as the page read them. */
export interface HistoryTick {
  readonly tickId: string;
  readonly atIso: string;
  readonly capacity: HistoryCapacity;
  readonly working: HistoryWorking;
  readonly ready: HistoryReady;
}

/** The window `fleet history` read. */
export interface FleetHistory {
  readonly observedAtIso: string;
  readonly fromIso: string;
  readonly toIso: string;
  /** Whether the read reached back to `fromIso`; when not, the history starts at its earliest tick. */
  readonly reachedFrom: boolean;
  readonly ticks: readonly HistoryTick[];
}

/** One tick, judged. */
export interface HistoryPoint {
  readonly atIso: string;
  readonly kind: FleetStateKind;
  /** What held it, in a few words — `cpu`, `the seat ceiling was not measured` — or empty when the badge says it all. */
  readonly cause: string;
  readonly working: number | undefined;
}

/** A run of adjacent ticks in one state for one cause. */
export interface HistorySpan {
  readonly kind: FleetStateKind;
  readonly badge: string;
  readonly cause: string;
  readonly fromIso: string;
  readonly toIso: string;
  readonly ticks: number;
  /** The fewest and most working across the span, `undefined` when no tick in it read the fleet. */
  readonly working: { readonly low: number; readonly high: number } | undefined;
}

/**
 * Whether the badge has read the fleet after every tick this history holds was finalised. The badge reads the machine
 * and the sessions live while a tick is recorded once a sweep, so between two ticks the badge can show a state the
 * newest span does not; the fold says so rather than letting that span pass for the state the badge shows.
 *
 * @param badgeReadAtIso the instant the badge's facts were read at
 * @returns true when the history is behind the badge, including when it holds no tick at all
 */
export function historyBehindBadge({
  history,
  badgeReadAtIso,
}: {
  history: FleetHistory;
  badgeReadAtIso: string;
}): boolean {
  const badgeMs = Date.parse(badgeReadAtIso);
  return history.ticks.every((tick) => Date.parse(tick.atIso) < badgeMs);
}

/**
 * The instant the badge's facts were read at: the LATEST of the readings it is built from. The badge mixes the
 * sessions, the board and the machine, each read on its own, so an older capacity reading must not hide a newer
 * sessions reading from {@link historyBehindBadge}.
 *
 * @param seatsReadAtIso when the sessions were read; always present, since the badge renders only once they are
 * @param otherReadAtIsos the other readings' instants, `undefined` for one not read yet
 * @returns the latest of them
 */
export function badgeReadAtOf({
  seatsReadAtIso,
  otherReadAtIsos,
}: {
  seatsReadAtIso: string;
  otherReadAtIsos: readonly (string | undefined)[];
}): string {
  let latest = seatsReadAtIso;
  for (const iso of otherReadAtIsos) {
    if (iso !== undefined && Date.parse(iso) > Date.parse(latest)) {
      latest = iso;
    }
  }
  return latest;
}

/**
 * When the history's newest tick was finalised: the latest instant, never the last row, so a document out of order
 * still names the right one.
 *
 * @returns that instant, or `undefined` for a history holding no tick
 */
export function newestTickIsoOf({ history }: { history: FleetHistory }): string | undefined {
  let newest: string | undefined;
  for (const tick of history.ticks) {
    if (newest === undefined || Date.parse(tick.atIso) > Date.parse(newest)) {
      newest = tick.atIso;
    }
  }
  return newest;
}

/**
 * One tick, judged by the badge's own rules.
 *
 * @returns the point
 */
export function historyPointOf({ tick }: { tick: HistoryTick }): HistoryPoint {
  if (tick.working.kind === "unavailable") {
    return { atIso: tick.atIso, cause: "the sessions were not read", kind: "not-measured", working: undefined };
  }
  const working = tick.working.working;
  if (tick.capacity.kind === "unavailable") {
    return { atIso: tick.atIso, cause: "the machine was not read", kind: "not-measured", working };
  }
  let openReadyCount: number | undefined;
  if (tick.ready.kind === "read") {
    openReadyCount = tick.ready.openReadyCount;
  }
  const verdict = fleetVerdictOf({
    capacity: tick.capacity.capacity,
    ceiling: tick.capacity.ceiling,
    nowIso: tick.capacity.observedAtIso,
    openReadyCount,
    working,
  });
  const kind = fleetStateKindOf({ glance: verdict });
  let cause = "";
  if (kind === "holding-machine") {
    cause = tick.capacity.capacity.holdSubjects.join(", ");
  }
  if (kind === "not-measured") {
    cause = "how many sessions the plans carry was not measured";
    // The shared verdict binds an unread board to "board"; the tick's own words say why it was not read.
    if (verdict.binding === "board" && tick.ready.kind === "not-recorded") {
      cause = tick.ready.why;
    }
  }
  return { atIso: tick.atIso, cause, kind, working };
}

/**
 * The window's spans, newest first: adjacent ticks of one state and one cause folded into one.
 *
 * @returns the spans
 */
export function historySpansOf({ history }: { history: FleetHistory }): readonly HistorySpan[] {
  const spans: HistorySpan[] = [];
  for (const tick of history.ticks) {
    const point = historyPointOf({ tick });
    const last = spans.at(-1);
    if (last !== undefined && last.kind === point.kind && last.cause === point.cause) {
      spans[spans.length - 1] = {
        ...last,
        ticks: last.ticks + 1,
        toIso: point.atIso,
        working: widened({ point, working: last.working }),
      };
      continue;
    }
    spans.push({
      badge: FLEET_BADGES[point.kind],
      cause: point.cause,
      fromIso: point.atIso,
      kind: point.kind,
      ticks: 1,
      toIso: point.atIso,
      working: widened({ point, working: undefined }),
    });
  }
  return spans.toReversed();
}

/** A span's working range with one more point in it. */
function widened({ working, point }: { working: HistorySpan["working"]; point: HistoryPoint }): HistorySpan["working"] {
  if (point.working === undefined) {
    return working;
  }
  if (working === undefined) {
    return { high: point.working, low: point.working };
  }
  return { high: Math.max(working.high, point.working), low: Math.min(working.low, point.working) };
}
