/**
 * What CHANGED since the last fleet-health note, and whether that is worth a note now.
 *
 * A second floating note a few minutes after the first tells the owner nothing if the rows are broken in the same
 * way as before. The notes back off in frequency, but not far: the owner still cares a lot when something is
 * broken, and times are chosen to surface a note when it is likely to be wanted.
 *
 * MEASURED over one morning: ten `mon-health-deaths` notes in a few hours, every one pressed Done within
 * ten minutes and every one naming the same rows — the card was re-posted because the owner's Done settled it, not
 * because anything had changed. Reproduce:
 * `jq -r 'select(.kind=="posted" and (.step.id|startswith("mon-health"))) | [.step.postedIso, .step.id] | @tsv' ~/.slopweaver/hand-steps/steps.jsonl`
 *
 * ## A note says what changed, and a note with nothing new is not shown
 *
 * The last note's rows and signals are remembered ({@link FleetHealthShown}); each pass diffs what it reads against
 * them. A row newly failing or recovered, a job signal tripping or clearing, or the bot going down or coming back is
 * news, and so is a row whose card of the owner's moved ({@link FleetHealthDelta}'s `handMoved`), because a note's Details
 * are frozen when it goes up and its button must open a card that is open. The same rows failing again — however many
 * times — is not: that is exactly the note that is worthless to the owner.
 *
 * ## Paced, modestly, and by how bad the news is
 *
 * Bad news (a row newly failing, the bot going down) waits at most {@link BAD_NEWS_SPACING_MS} after the last note —
 * against the measured gaps of 10 to 53 minutes, so a cascade over a few ticks is one note, not four. Good news alone
 * (a recovery, the bot back) waits {@link GOOD_NEWS_SPACING_MS}: it asks nothing of the owner. Nothing is ever dropped —
 * a held pass leaves the memory untouched, so the note that does go up diffs against the last one the owner saw.
 *
 * ## Only in the owner's waking hours
 *
 * Outside {@link WAKING_HOURS} in the owner's own zone, news waits for the morning. Not only courtesy: `shown` means
 * POSTED, never seen, so an overnight chain of notes would each diff against one the owner never read, and the
 * morning's note would file the night's first breakage under "still failing". Held until the owner is up, the
 * morning's note diffs against the last one they could have read. Every Done in the measurement above landed
 * within one span of three hours and twenty-seven minutes.
 *
 * Pure: the memory, the rows and a clock in; a delta, a sentence and a verdict out.
 */
import { BRIEFING_TIME_ZONE } from "../briefing/localDay.js";
import { DETAIL_LINE_CAP, DETAILS_MAX, detailActMarker, detailEntry } from "../hand/details.js";
import { fitLine } from "../hand/push/notice.js";

import { fateClause, type RowFate } from "./fleetHealthFate.js";
import type { FleetHealthDelta, FleetHealthShown } from "./types.js";

/** How long after the last note bad news — a row newly failing, the bot going down — waits at most. */
const BAD_NEWS_SPACING_MS = 30 * 60 * 1000;

/** How long after the last note good news alone — a recovery, the bot back — waits. It asks nothing of the owner. */
const GOOD_NEWS_SPACING_MS = 2 * 60 * 60 * 1000;

/** The local hours, in {@link BRIEFING_TIME_ZONE}, a note may go up in: from 07:00 until 22:00. */
const WAKING_HOURS: { readonly from: number; readonly until: number } = { from: 7, until: 22 };

/** The hour of an instant in the owner's zone, 0–23. Module-scoped so the formatter is built once. */
const LOCAL_HOUR = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  hourCycle: "h23",
  timeZone: BRIEFING_TIME_ZONE,
});

/**
 * What changed between the last note and the rows failing now.
 *
 * @param shown what the last note showed, or `undefined` when there was none — every failing row and signal is then new
 * @param broken the recipe ids failing now
 * @param botDown whether the listener is off the air now
 * @param signals the job signals tripped now, in key order
 * @param yours each row's card of the owner's now, as {@link yoursEntry} writes it
 * @param noteUp whether the last note is still on the owner's screen, its card open and never put away
 * @returns the delta, each row list sorted, each signal list in key order
 */
export function fleetHealthDelta({
  shown,
  broken,
  botDown,
  signals,
  yours,
  noteUp,
}: {
  shown: FleetHealthShown | undefined;
  broken: readonly string[];
  botDown: boolean;
  signals: readonly string[];
  yours: readonly string[];
  noteUp: boolean;
}): FleetHealthDelta {
  const before = new Set(shown === undefined ? [] : shown.broken);
  const now = new Set(broken);
  const wasDown = shown?.botDown === true;
  const signalledBefore = shown === undefined ? [] : shown.signals;
  return {
    bot: botChange({ botDown, wasDown }),
    handMoved: handMoved({ noteUp, shown: shown === undefined ? [] : shown.yours, yours }),
    newlyFailing: [...now].filter((id) => !before.has(id)).toSorted(),
    recovered: [...before].filter((id) => !now.has(id)).toSorted(),
    stillFailing: [...now].filter((id) => before.has(id)).toSorted(),
    tripped: signals.filter((signal) => !signalledBefore.includes(signal)),
    untripped: signalledBefore.filter((signal) => !signals.includes(signal)),
  };
}

/**
 * One row's card of the owner's as the memory holds it: `<recipe id> <card id>`. A recipe id and a step id carry no space,
 * so the pair splits back unambiguously.
 *
 * @param recipeId the failing row
 * @param card the open card its button opens
 * @returns the entry
 */
export function yoursEntry({ recipeId, card }: { recipeId: string; card: string }): string {
  return `${recipeId} ${card}`;
}

/**
 * The rows whose card of the owner's moved. A card the last note gave no button to is always news: it is something
 * only the owner can do. A button whose card closed is news only while that note is still up — once the owner has put
 * it away there is no stale button on their screen, and raising a note to say a row is no longer theirs is the
 * re-raise to avoid.
 */
function handMoved({
  shown,
  yours,
  noteUp,
}: {
  shown: readonly string[];
  yours: readonly string[];
  noteUp: boolean;
}): readonly string[] {
  const before = new Set(shown);
  const now = new Set(yours);
  const arrived = yours.filter((entry) => !before.has(entry));
  const gone = noteUp ? shown.filter((entry) => !now.has(entry)) : [];
  return [...new Set([...arrived, ...gone].map((entry) => entry.split(" ")[0]!))].toSorted();
}

/** The listener against the last note. */
function botChange({ botDown, wasDown }: { botDown: boolean; wasDown: boolean }): FleetHealthDelta["bot"] {
  if (botDown) {
    return wasDown ? "still-down" : "down";
  }
  return wasDown ? "back" : "up";
}

/**
 * Whether a delta carries bad news — something newly broken.
 *
 * @param delta what changed
 * @returns true when a row is newly failing, a job signal newly tripped, the bot just went down, or what is the owner's moved
 */
function isBadNews({ delta }: { delta: FleetHealthDelta }): boolean {
  return (
    delta.newlyFailing.length > 0 || delta.tripped.length > 0 || delta.bot === "down" || delta.handMoved.length > 0
  );
}

/**
 * Whether a delta carries any news at all.
 *
 * @param delta what changed
 * @returns true when a row, a job signal or the bot changed state
 */
export function isNews({ delta }: { delta: FleetHealthDelta }): boolean {
  return isBadNews({ delta }) || delta.recovered.length > 0 || delta.untripped.length > 0 || delta.bot === "back";
}

/** Whether this pass may show a note, or why it holds. */
export type FleetHealthPacing = { readonly kind: "show" } | { readonly kind: "hold"; readonly why: string };

/**
 * Whether a note goes up this pass: never without news, never outside the owner's waking hours, and not sooner than its
 * spacing after the last note.
 *
 * @param delta what changed since the last note
 * @param shown the last note, or `undefined` when there was none
 * @param nowIso the pass's own instant
 * @returns show, or hold with the reason a reader is given
 */
export function fleetHealthPacing({
  delta,
  shown,
  nowIso,
}: {
  delta: FleetHealthDelta;
  shown: FleetHealthShown | undefined;
  nowIso: string;
}): FleetHealthPacing {
  if (!isNews({ delta })) {
    const since = shown === undefined ? "" : ` since the note at ${hhmmZ({ ms: Date.parse(shown.shownIso) })}`;
    return { kind: "hold", why: `nothing changed${since} — the same rows are failing` };
  }
  if (!inWakingHours({ nowIso })) {
    return {
      kind: "hold",
      why: `news waits for the morning — notes go up ${String(WAKING_HOURS.from)}:00–${String(WAKING_HOURS.until)}:00 ${BRIEFING_TIME_ZONE}`,
    };
  }
  if (shown === undefined) {
    return { kind: "show" };
  }
  const bad = isBadNews({ delta });
  const spacing = bad ? BAD_NEWS_SPACING_MS : GOOD_NEWS_SPACING_MS;
  const dueMs = Date.parse(shown.shownIso) + spacing;
  if (Date.parse(nowIso) < dueMs) {
    return {
      kind: "hold",
      why: `${bad ? "bad" : "good"} news waits until ${hhmmZ({ ms: dueMs })}, ${String(spacing / 60_000)} min after the last note`,
    };
  }
  return { kind: "show" };
}

/**
 * Whether an instant falls in the owner's waking hours, read in their own zone by `Intl` — never by offset arithmetic, which is
 * wrong across a daylight-saving change (`../briefing/localDay.ts`).
 *
 * @param nowIso the instant
 * @returns true from {@link WAKING_HOURS}' `from` hour up to, not including, its `until` hour
 */
export function inWakingHours({ nowIso }: { nowIso: string }): boolean {
  const hour = Number(
    LOCAL_HOUR.formatToParts(new Date(Date.parse(nowIso))).find((part) => part.type === "hour")!.value,
  );
  return hour >= WAKING_HOURS.from && hour < WAKING_HOURS.until;
}

/** `HH:MMZ` of an epoch instant. */
function hhmmZ({ ms }: { ms: number }): string {
  return `${new Date(ms).toISOString().slice(11, 16)}Z`;
}

/**
 * The delta as a clause the note's sentence leads with — counts only, since the names are behind the disclosure.
 *
 * @param delta what changed
 * @returns e.g. `2 scheduled jobs newly failing, 1 recovered, 7 still failing`, led by `syncs are dying mid-run` when
 *   deaths just tripped, or the empty string when neither rows nor deaths moved
 */
export function deltaClause({ delta }: { delta: FleetHealthDelta }): string {
  const parts: string[] = [];
  if (delta.tripped.includes("deaths")) {
    parts.push("syncs are dying mid-run");
  }
  if (delta.newlyFailing.length > 0) {
    parts.push(
      `${String(delta.newlyFailing.length)} scheduled ${jobs({ n: delta.newlyFailing.length })} newly failing`,
    );
  }
  if (delta.recovered.length > 0) {
    parts.push(`${String(delta.recovered.length)} recovered`);
  }
  if (delta.stillFailing.length > 0) {
    parts.push(`${String(delta.stillFailing.length)} still failing`);
  }
  return parts.join(", ");
}

/** `job` or `jobs`. */
function jobs({ n }: { n: number }): string {
  return n === 1 ? "job" : "jobs";
}

/** One recipe with a failing or dying run in the window, as the note's details name it (`./fleetHealthAttempts.ts`). */
export interface FailingRow {
  readonly recipeId: string;
  /** The fate of its newest counted run: `failing` when that failed or died, `recovered` when it succeeded. */
  readonly state: "failing" | "recovered";
  /** How many of its runs in the window failed or died. */
  readonly failures: number;
  /** When its latest failure was observed. */
  readonly lastFailedIso: string;
  /** Why its latest failure happened, as the ledger recorded it. */
  readonly why: string;
}

/**
 * Every line of the fleet's health, uncut — what `monitor check --only fleet-unhealthy` prints, and what the note's
 * disclosure carries the head of ({@link detailsOnTheNote}): the bot, then each row newly failing, still failing,
 * recovered, and failed earlier in the day but clean since, with when it last failed and why. Within each group the
 * newest failure leads, and each is timed by its AGE at the pass: a bare `HH:MMZ` could be that
 * morning or the day before.
 *
 * @param delta what changed since the last note
 * @param rows every row with a failure in the window, newest failure first (`./fleetHealthAttempts.ts` § failingRows)
 * @param botLine the listener's own reading, when it is off the air
 * @param nowIso the pass's instant, each failure's age is measured from
 * @param fates what the fleet is doing about each failing row, by recipe id; a failing row absent from it keeps
 *   its recorded why alone
 * @returns one line per row, and one for the bot when it is off the air or came back
 */
export function fleetHealthLines({
  delta,
  rows,
  botLine,
  nowIso,
  fates,
}: {
  delta: FleetHealthDelta;
  rows: readonly FailingRow[];
  botLine: string | undefined;
  nowIso: string;
  fates: ReadonlyMap<string, RowFate>;
}): readonly string[] {
  const byId = new Map(rows.map((row) => [row.recipeId, row]));
  const rank = new Map(rows.map((row, index) => [row.recipeId, index]));
  const newestFirst = ({ ids }: { ids: readonly string[] }): readonly string[] =>
    ids.toSorted((a, b) => rankOf({ id: a, rank }) - rankOf({ id: b, rank }) || a.localeCompare(b));
  const nowMs = Date.parse(nowIso);
  const lines = [
    ...(botLine === undefined ? [] : [`${botTag({ delta })} the bot off Slack — ${botLine}`]),
    ...newestFirst({ ids: delta.newlyFailing }).map((id) =>
      rowLine({ fate: fates.get(id), id, nowMs, row: byId.get(id), tag: "NEW  " }),
    ),
    ...newestFirst({ ids: delta.stillFailing }).map((id) =>
      rowLine({ fate: fates.get(id), id, nowMs, row: byId.get(id), tag: "STILL" }),
    ),
    ...newestFirst({ ids: delta.recovered }).map((id) => recoveredLine({ id, nowMs, row: byId.get(id) })),
    // A row that failed or died in the window and has since run clean was never on a note as failing, so it is
    // neither news nor recovered — but it is what the day's counts, and a `deaths` trip, are made of.
    ...rows
      .filter((row) => row.state === "recovered" && !delta.recovered.includes(row.recipeId))
      .map((row) =>
        rowLine({ fate: undefined, id: row.recipeId, nowMs, row, tag: "PAST " }).concat("; ran clean since"),
      ),
  ];
  if (delta.bot === "back") {
    lines.unshift("BACK  the bot is on Slack again");
  }
  return lines;
}

/**
 * The head of {@link fleetHealthLines} the note's disclosure carries, composed INSIDE the register's caps
 * (`../hand/details.ts`) rather than refused by them: each line fitted, a cut one ending `…`, and past the count a last line naming the
 * verb that prints every one.
 *
 * @param lines every line, uncut
 * @param trailing informational lines kept at the foot past any cut, so a long fleet never hides them behind the
 *   `+N more` line
 * @returns the lines, at most {@link DETAILS_MAX}, each at most {@link DETAIL_LINE_CAP} characters
 */
export function detailsOnTheNote({
  lines,
  trailing = [],
}: {
  lines: readonly string[];
  trailing?: readonly string[];
}): readonly string[] {
  const fitted = lines.map((line) => fitDetail({ text: line }));
  const foot = trailing.map((line) => fitDetail({ text: line }));
  if (fitted.length + foot.length <= DETAILS_MAX) {
    return [...fitted, ...foot];
  }
  const kept = fitted.slice(0, DETAILS_MAX - 1 - foot.length);
  const more = fitted.length - kept.length;
  return [...kept, `+${String(more)} more — slopweaver monitor check --only fleet-unhealthy prints every one`, ...foot];
}

/**
 * One line fitted inside {@link DETAIL_LINE_CAP}, at a word boundary, and MARKED where it was cut: a reason that
 * stops mid-sentence with nothing after it reads as whole. A
 * line's act marker is kept whole and the words before it are what is cut — cut, the marker would be the one part
 * of the line the note could no longer draw as the owner's button.
 */
function fitDetail({ text }: { text: string }): string {
  const whole = text.trim();
  if (whole.length <= DETAIL_LINE_CAP) {
    return whole;
  }
  const { act } = detailEntry({ line: whole });
  const marker = act === "" ? "" : detailActMarker({ id: act });
  const body = whole.slice(0, whole.length - marker.length);
  const cut = fitLine({ cap: DETAIL_LINE_CAP - 1 - marker.length, text: body }).replace(/[\s,;:—-]+$/u, "");
  return `${cut}…${marker}`;
}

/** The bot line's tag: `NEW` when it just went down, `STILL` when it was down on the last note too. */
function botTag({ delta }: { delta: FleetHealthDelta }): string {
  return delta.bot === "down" ? "NEW  " : "STILL";
}

/** A row's place in the newest-failure-first order; a row with no failure in the window sorts after every one that has. */
function rankOf({ id, rank }: { id: string; rank: ReadonlyMap<string, number> }): number {
  const at = rank.get(id);
  if (at === undefined) {
    return rank.size;
  }
  return at;
}

/** How long before the pass an instant was, as `45m ago` or `22h ago`. */
function ageOf({ iso, nowMs }: { iso: string; nowMs: number }): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  return `${String(Math.floor(minutes / 60))}h ago`;
}

/** One failing row's line. */
function rowLine({
  id,
  row,
  fate,
  tag,
  nowMs,
}: {
  id: string;
  row: FailingRow | undefined;
  /** What the fleet is doing about it — absent on a row that ran clean since, where nothing is being done. */
  fate: RowFate | undefined;
  tag: string;
  nowMs: number;
}): string {
  if (row === undefined) {
    return `${tag} ${id}`;
  }
  const times = row.failures === 1 ? "once" : `${String(row.failures)}× in 24h`;
  const when = `${ageOf({ iso: row.lastFailedIso, nowMs })}, ${times}`;
  if (fate === undefined) {
    return `${tag} ${id} — ${when}: ${row.why}`;
  }
  return `${tag} ${id} — ${when}: ${fateClause({ fate, why: row.why })}`;
}

/** One recovered row's line — its newest run succeeded, or its last failure left the window. */
function recoveredLine({ id, row, nowMs }: { id: string; row: FailingRow | undefined; nowMs: number }): string {
  if (row === undefined) {
    return `FIXED ${id} — no failure left in the last 24h`;
  }
  return `FIXED ${id} — last failed ${ageOf({ iso: row.lastFailedIso, nowMs })}, its newest run succeeded`;
}
