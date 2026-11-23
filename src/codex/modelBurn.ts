/**
 * How many Codex sessions each model buys per window — the measurement behind `slopweaver codex burn`.
 *
 * A model that spends a whole account in under a day is replaced by a cheaper default, and the NEXT pick is made
 * on evidence — passes per five-hour window and per
 * week on each model, read off the rollout logs. The owner's guess is two to four times as many on the cheaper model. This module is
 * the arithmetic that turns the logs into that number; `./modelBurnScan.ts` reads them.
 *
 * ## The one idea: telescoping deltas, credited to whoever closed them
 *
 * Codex writes no per-turn cost in percent — only the running `used_percent` of each window, on every
 * `token_count` event. So per window label, across every destination, every reading is sorted by instant and each
 * RISE between consecutive readings of ONE window — one `resets_at` — is credited to the session whose reading
 * closes it.
 * Summed, the rises telescope to exactly what the account drew over the scan, whatever the interleaving. What
 * interleaving DOES blur is which of two concurrent sessions drew a given point — so a group is only as clean
 * as its sessions were separated in time, and the report prints its span so a reader can see a mixed period.
 *
 * Four rules keep the sum honest:
 *
 *  1. **Each window is its own timeline.** Two accounts can write into one Codex home — measured
 *     when a re-sign-in moved `~/.codex` to another plan and that day's rollouts carried two weekly
 *     `resets_at` instants six and three-quarter hours apart, interleaved. Read as one timeline, every switch
 *     looked like a reset and drew a whole window's percentage. Reproduce:
 *     `cat ~/.codex/sessions/2026/09/22/*.jsonl | grep -o '"resets_at":[0-9]*' | sort | uniq -c`.
 *  2. **A window's first reading is a BASELINE, never a draw.** The scan starts mid-window, and crediting its
 *     whole `used_percent` would charge one session for a week of history —
 *  3. **unless the window OPENED inside the scan**: its start (`resets_at` less the window's width) falls after
 *     the destination's first reading and no later than this one. Then every point it holds accrued while the
 *     scan was watching, and the reading draws its own percentage. An unrelated window having reset proves
 *     nothing about this one — a Codex review of this module found exactly that counterexample, where an
 *     interleaved account's expired window let another account's pre-scan usage count as a fresh draw.
 *  4. **A fall inside one window is a stale report, and draws zero** — concurrent sessions each report the
 *     percentage as of their own last turn, so one window's readings dip and recover dozens of times a day
 *     (49 dips across 2,182 readings of one window on one day; same repro). Rises are therefore measured from
 *     the window's HIGH-WATER mark, never from the reading just before, or every recovery would be drawn twice.
 *     One edge survives: when the scan's very first reading of a window is itself a dip, the high-water mark
 *     before it lies outside the scan, and the recovery counts as drawn. That over-counts by the dip's depth,
 *     and dips measured at most 3 points (`./gaugeScan.ts`'s `atHighWaterMark` carries the repro).
 *
 * Sessions are grouped by model, reasoning effort and plan type, because all three move the number: the
 * `gpt-5.6-sol` history on this machine ran at `xhigh` on a different plan from today's `medium` Pro seats,
 * and merging those rows would compare an account size and an effort as though they were a model.
 *
 * Pure. A session list in, a report out.
 */
import { parseIsoMs } from "#lib/date.js";

import type { CodexWindowLabel } from "./gauge.js";

/** The two windows a burn is measured against. `other` widths are counted as readings and never as draws. */
type BurnWindow = Extract<CodexWindowLabel, "weekly" | "five-hour">;

/** One window reading, as `./modelBurnScan.ts` lifts it off a `token_count` event. */
export interface BurnReading {
  readonly observedAtIso: string;
  readonly window: BurnWindow;
  /** 0..100 on the provider's own scale. */
  readonly usedPercent: number;
  /** When this window resets — the identity of the window, since two readings of one window share it. */
  readonly resetAtIso: string | undefined;
  readonly planType: string | undefined;
}

/** One rollout file: a Codex session, what it ran on, and every reading its tail carried. */
export interface BurnSession {
  /** The register alias of the destination whose home held the file. */
  readonly destination: string;
  readonly sessionId: string;
  /** The model the session's first turn asked for, or undefined when no `turn_context` was found. */
  readonly model: string | undefined;
  readonly effort: string | undefined;
  /** `pass` when Slopweaver's SDK opened it (`thread_source: slopweaver`), `seat` for everything else. */
  readonly origin: "pass" | "seat";
  readonly readings: readonly BurnReading[];
}

/** One (model, effort, plan type) group's measurement. */
export interface ModelBurnRow {
  readonly model: string;
  readonly effort: string;
  readonly planType: string;
  readonly sessions: number;
  readonly passes: number;
  readonly seats: number;
  /**
   * Percentage points of the weekly window this group drew, summed across destinations — or undefined when
   * no session in the group carried a single reading of that window, which is "not measured", never 0%.
   */
  readonly weeklyDrawn: number | undefined;
  readonly fiveHourDrawn: number | undefined;
  /**
   * Sessions per one whole weekly window — `sessions / (weeklyDrawn / 100)` — or undefined when the group drew
   * nothing measurable, which is "not measured" and never infinity.
   */
  readonly sessionsPerWeek: number | undefined;
  readonly sessionsPerFiveHours: number | undefined;
  readonly firstIso: string | undefined;
  readonly lastIso: string | undefined;
  readonly destinations: readonly string[];
}

/** The whole report. */
export interface ModelBurnReport {
  readonly rows: readonly ModelBurnRow[];
  /** Sessions whose model could not be read — counted, never folded into a model they may not have run. */
  readonly unattributedSessions: number;
  readonly readings: number;
}

/**
 * How far apart two `resets_at` instants may be and still name one window. Codex jitters one window's reset
 * between events: MEASURED over a month of weekly reading on this machine, the widest spread
 * inside one window was 29 seconds and distinct windows sat hours apart. Forty-five seconds covers the jitter;
 * it was two minutes until a Codex review showed two accounts' windows a minute apart would merge and fabricate
 * a rise. The plan type is deliberately NOT part of a window's identity: one account's readings of one window
 * named it both `unknown` and `self_serve_business_prolite` in early September. The residue, stated: two
 * accounts sharing one home whose windows reset under 45 seconds apart still merge — the log carries no account
 * id, so that separation is indistinguishable from one window's measured jitter.
 * Reproduce (prints each cluster's first reset, last reset and spread in seconds):
 * `cat ~/.codex/sessions/2026/09/[0-9]*[0-9]/*.jsonl | grep -o '"window_minutes":10080,"resets_at":[0-9]*' |
 * grep -o '[0-9]*$' | sort -nu | awk 'NR==1{s=$1} NR>1&&$1-p>300{print s,p,p-s;s=$1} {p=$1} END{print s,p,p-s}'`
 */
export const SAME_WINDOW_TOLERANCE_MS = 45_000;

/** The label a session with no readable field is grouped under, so an absence is visible as itself. */
const UNREAD = "unread";

/** A reading paired with the session that wrote it, and its instant parsed once. */
interface TimedReading {
  readonly reading: BurnReading;
  readonly session: BurnSession;
  readonly observedMs: number;
}

/**
 * Whether a reading names a window it could still draw on. One without a `resets_at` cannot be tied to ANY
 * window, so it draws nothing and counts as no reading of it: two such readings from interleaved accounts would
 * otherwise pass for one window and fabricate a rise between them — a Codex review found that shape. One taken
 * at or after its own reset describes a CLOSED window, and a rise credited to it would be invented usage (a
 * second review), so it is no reading either.
 */
function identifiesWindow({ reading }: { reading: BurnReading }): boolean {
  if (reading.resetAtIso === undefined) {
    return false;
  }
  const resetMs = parseIsoMs({ tsIso: reading.resetAtIso });
  const observedMs = parseIsoMs({ tsIso: reading.observedAtIso });
  return resetMs === undefined || observedMs === undefined || resetMs > observedMs;
}

/** Whether two readings belong to the same window, judged by their reset instants. Unnamed never matches. */
function sameWindow({ left, right }: { left: BurnReading; right: BurnReading }): boolean {
  return resetsMatch({ leftIso: left.resetAtIso, rightIso: right.resetAtIso });
}

/**
 * Whether two `resets_at` instants name one window, within {@link SAME_WINDOW_TOLERANCE_MS}'s measured jitter.
 * An absent or unparseable instant never matches. Shared with `./gaugeScan.ts`'s per-window high-water mark.
 *
 * @param leftIso one reading's reset instant
 * @param rightIso the other's
 * @returns true when both parse and sit within the tolerance
 */
export function resetsMatch({
  leftIso,
  rightIso,
}: {
  leftIso: string | undefined;
  rightIso: string | undefined;
}): boolean {
  if (leftIso === undefined || rightIso === undefined) {
    return false;
  }
  const leftMs = parseIsoMs({ tsIso: leftIso });
  const rightMs = parseIsoMs({ tsIso: rightIso });
  if (leftMs === undefined || rightMs === undefined) {
    return false;
  }
  return Math.abs(leftMs - rightMs) <= SAME_WINDOW_TOLERANCE_MS;
}

/** How long each window runs from its opening to its `resets_at`: Codex's own `window_minutes`, 10080 and 300. */
const WINDOW_MS: Readonly<Record<BurnWindow, number>> = { "five-hour": 5 * 3_600_000, weekly: 7 * 86_400_000 };

/**
 * Whether a reading's window opened inside the scan — after the timeline's first reading, and no later than
 * this one. An unreadable reset never proves it.
 *
 * @param entry the first reading seen of its window
 * @param timelineStartMs the instant of the destination's first reading on this window label
 * @returns true only when every point the window holds accrued while the scan was watching
 */
function openedInsideScan({ entry, timelineStartMs }: { entry: TimedReading; timelineStartMs: number }): boolean {
  if (entry.reading.resetAtIso === undefined) {
    return false;
  }
  const resetMs = parseIsoMs({ tsIso: entry.reading.resetAtIso });
  if (resetMs === undefined) {
    return false;
  }
  const openedMs = resetMs - WINDOW_MS[entry.reading.window];
  return openedMs > timelineStartMs && openedMs <= entry.observedMs;
}

/**
 * Each window's highest reading so far, after one more reading — a lower one leaves its window's mark alone.
 *
 * @param latest the high-water reading of each distinct window already seen on this timeline
 * @param entry the reading just credited
 * @returns the marks, this reading's window updated only when it rose or was new
 */
function highWaterMarks({ latest, entry }: { latest: readonly BurnReading[]; entry: TimedReading }): BurnReading[] {
  const mark = latest.find((seen) => sameWindow({ left: seen, right: entry.reading }));
  if (mark !== undefined && mark.usedPercent >= entry.reading.usedPercent) {
    return [...latest];
  }
  return [...latest.filter((seen) => seen !== mark), entry.reading];
}

/**
 * The rise one reading closes on one window label, per the header's four rules.
 *
 * @param latest the high-water reading of each distinct window already seen on this timeline
 * @param entry the reading being credited
 * @param timelineStartMs the instant of the destination's first reading on this window label
 * @returns percentage points drawn — zero for a baseline or a fall
 */
function riseOf({
  latest,
  entry,
  timelineStartMs,
}: {
  latest: readonly BurnReading[];
  entry: TimedReading;
  timelineStartMs: number;
}): number {
  const previous = latest.find((seen) => sameWindow({ left: seen, right: entry.reading }));
  if (previous !== undefined) {
    return Math.max(0, entry.reading.usedPercent - previous.usedPercent);
  }
  if (openedInsideScan({ entry, timelineStartMs })) {
    return Math.max(0, entry.reading.usedPercent);
  }
  return 0;
}

/** The group key a session is measured under. */
function groupKeyOf({ session }: { session: BurnSession }): string {
  return JSON.stringify([session.model, labelOr({ value: session.effort }), planTypeOf({ session })]);
}

/** A field's own value, or the visible {@link UNREAD} label when the log did not carry one. */
function labelOr({ value }: { value: string | undefined }): string {
  if (value === undefined) {
    return UNREAD;
  }
  return value;
}

/** The plan type a session's readings name, first one wins, or {@link UNREAD}. */
function planTypeOf({ session }: { session: BurnSession }): string {
  const named = session.readings.find((reading) => reading.planType !== undefined);
  return labelOr({ value: named?.planType });
}

/**
 * Every rise on every window, credited to the session that closed it.
 *
 * ONE timeline per window label across every destination, never one per destination: a window is named by its
 * reset instant, and one account signed into two homes writes the same window into both, so per-destination
 * timelines drew each of its rises once per home — a Codex review's counterexample, 10%→60% in two homes read
 * as 100 points. Two DIFFERENT accounts' windows stay apart by their resets, exactly as within one home. What
 * stays per destination is where the scan STARTED: a home first read yesterday has no history before
 * yesterday, so its first reading is its baseline however old its window is. The cost is an UNDER-count, and
 * it is chosen: one account in two homes whose new window's first reading lands in the home read later draws
 * nothing for that window's opening (a Codex review). One start across every home would credit it — and would
 * equally credit a DIFFERENT account's whole window opened before its own home's first reading, inventing
 * usage, since the log carries no account id to tell the two apart.
 *
 * @param sessions every session the scan read
 * @returns percentage points drawn per session id, per window
 */
function creditedRises({
  sessions,
}: {
  sessions: readonly BurnSession[];
}): ReadonlyMap<BurnSession, Readonly<Record<BurnWindow, number>>> {
  const credited = new Map<BurnSession, Record<BurnWindow, number>>();
  for (const session of sessions) {
    credited.set(session, { "five-hour": 0, weekly: 0 });
  }
  for (const window of ["weekly", "five-hour"] as const) {
    const timeline = sessions
      .flatMap((session) =>
        session.readings
          .filter((reading) => reading.window === window && identifiesWindow({ reading }))
          .map((reading) => ({ observedMs: parseIsoMs({ tsIso: reading.observedAtIso }), reading, session })),
      )
      .filter((entry): entry is TimedReading => entry.observedMs !== undefined)
      .toSorted((left, right) => left.observedMs - right.observedMs);
    const startByDestination = new Map<string, number>();
    for (const entry of timeline) {
      if (!startByDestination.has(entry.session.destination)) {
        startByDestination.set(entry.session.destination, entry.observedMs);
      }
    }
    let latest: BurnReading[] = [];
    for (const entry of timeline) {
      const timelineStartMs = startByDestination.get(entry.session.destination)!;
      credited.get(entry.session)![window] += riseOf({ entry, latest, timelineStartMs });
      latest = highWaterMarks({ entry, latest });
    }
  }
  return credited;
}

/**
 * The points a group drew on one window, or undefined when none of its sessions read that window at all.
 *
 * @param members the group's sessions
 * @param credited what each session was credited, per window
 * @param window which window to sum
 * @returns the summed draw, or undefined for a window the group never saw
 */
function drawnOn({
  members,
  credited,
  window,
}: {
  members: readonly BurnSession[];
  credited: ReadonlyMap<BurnSession, Readonly<Record<BurnWindow, number>>>;
  window: BurnWindow;
}): number | undefined {
  const read = members.some((session) =>
    session.readings.some((reading) => reading.window === window && identifiesWindow({ reading })),
  );
  if (!read) {
    return undefined;
  }
  return members.reduce((sum, session) => sum + credited.get(session)![window], 0);
}

/** Sessions per one whole window, or undefined when nothing measurable was drawn. */
function perWindow({ sessions, drawn }: { sessions: number; drawn: number | undefined }): number | undefined {
  if (drawn === undefined || drawn <= 0) {
    return undefined;
  }
  return sessions / (drawn / 100);
}

/** The earliest and latest reading instants a group's sessions carried. */
function spanOf({ sessions }: { sessions: readonly BurnSession[] }): {
  readonly firstIso: string | undefined;
  readonly lastIso: string | undefined;
} {
  const instants = sessions
    .flatMap((session) => session.readings.map((reading) => reading.observedAtIso))
    .map((iso) => ({ iso, ms: parseIsoMs({ tsIso: iso }) }))
    .filter((entry): entry is { iso: string; ms: number } => entry.ms !== undefined)
    .toSorted((left, right) => left.ms - right.ms);
  return { firstIso: instants[0]?.iso, lastIso: instants.at(-1)?.iso };
}

/**
 * Measure how many sessions each (model, effort, plan type) bought per weekly and five-hour window.
 *
 * @param sessions every session the scan read, across every destination
 * @returns one row per group, busiest first, plus what could not be attributed
 */
export function buildModelBurnReport({ sessions }: { sessions: readonly BurnSession[] }): ModelBurnReport {
  const credited = creditedRises({ sessions });
  const attributed = sessions.filter((session) => session.model !== undefined);
  const groups = new Map<string, BurnSession[]>();
  for (const session of attributed) {
    const key = groupKeyOf({ session });
    const members = groups.get(key);
    if (members === undefined) {
      groups.set(key, [session]);
    } else {
      members.push(session);
    }
  }
  const rows = [...groups.values()].map((members): ModelBurnRow => {
    const first = members[0]!;
    const weeklyDrawn = drawnOn({ credited, members, window: "weekly" });
    const fiveHourDrawn = drawnOn({ credited, members, window: "five-hour" });
    const passes = members.filter((session) => session.origin === "pass").length;
    return {
      destinations: [...new Set(members.map((session) => session.destination))].toSorted(),
      effort: labelOr({ value: first.effort }),
      fiveHourDrawn,
      model: first.model!,
      passes,
      planType: planTypeOf({ session: first }),
      seats: members.length - passes,
      sessions: members.length,
      sessionsPerFiveHours: perWindow({ drawn: fiveHourDrawn, sessions: members.length }),
      sessionsPerWeek: perWindow({ drawn: weeklyDrawn, sessions: members.length }),
      weeklyDrawn,
      ...spanOf({ sessions: members }),
    };
  });
  return {
    readings: sessions.reduce((sum, session) => sum + session.readings.length, 0),
    rows: rows.toSorted((left, right) => right.sessions - left.sessions),
    unattributedSessions: sessions.length - attributed.length,
  };
}
