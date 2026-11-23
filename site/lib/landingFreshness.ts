/**
 * When the console takes a fresh `github landing` reading ITSELF, the only way the landing reading refreshes between
 * ticks. ONE owner asks — the console SHELL, on every page, through one runner
 * (`../components/console/useLandingAutoRefresh.ts`) and one backoff — on two grounds:
 *
 * - a reading EVENT — the reading shown cannot give GitHub's count, or cannot be counted as the whole population
 *   (drafts left out, or rows GitHub's list does not reconcile with — `pullRequestPopulation.ts`), or there is no
 *   reading it can show at all (`NO_READING_ID`) — whatever the page ({@link readingEventReasonOf});
 * - the reading shown coming DUE — within {@link REFRESH_HEADROOM_MINUTES} of the cadence, so the new one lands before
 *   the old one passes it ({@link landingDueOf}). Owned by the Pull requests page, this ran only while that page was
 *   mounted, and the sidebar badge sat on a warning all day on the Queue.
 *
 * Both are asked only while the console is in view; a hidden one asks nothing until it is.
 *
 * Measured, the page read a 58-minute-old document: the page's count must equal GitHub's, with a
 * reading no older than the landing cadence. The supervisor tick reads on that cadence only while a tick runs,
 * so a page the owner opens between ticks would otherwise show whatever the last one left. It keeps `syncVerbs.ts`'s
 * "never on a free-running timer". The per-reading backoff, the console's own memory of what it asked over and the
 * in-flight join every page-owned reading shares are in `syncFreshness.ts`.
 *
 * A reading the console's own refresh took is retried for a missing or unread census, or a population that does not
 * reconcile, only once it is `AUTO_RETRY_MINUTES` old — each run records a new reading, so a census GitHub will not
 * give (a repository past its page cap, say) costs one run per backoff, never a loop, and a transient failure is not
 * stranded until the reading comes due.
 *
 * Pure: the reading's facts and the instant in, the decision out.
 */

import type { LandingRepoCensus, LandingSelection } from "../components/live/readLanding";
import { AUTO_RETRY_MINUTES, SYNC_NOW_BY } from "./syncFreshness";

/**
 * The landing cadence, in minutes: how old a reading may be. Mirrors `DEFAULT_CADENCE_MINUTES` in
 * `src/review/readCadence.ts`, which the tick's `--if-due` reads on, and
 * `site/__tests__/unit/landingFreshness.test.ts` fails when the two differ.
 */
export const LANDING_CADENCE_MINUTES = 30;

/**
 * How long before the cadence the page starts its own reading, so the new one is recorded before the old one
 * passes it. MEASURED: the two-repository read took 146.5s (`LANDING_TIMEOUT_MS` in
 * `syncVerbs.ts` carries the repro), and the page re-asks once a minute — five minutes covers both with room.
 */
export const REFRESH_HEADROOM_MINUTES = 5;

/**
 * Why a reading's rows cannot be counted as the owner's whole open population, when its census read: it was taken without
 * drafts, or GitHub's open list names one of theirs the rows do not carry, or a row GitHub no longer lists open.
 */
export type PopulationGap = "drafts-excluded" | "rows-short";

/**
 * Why the reading shown calls for a fresh one by what it IS, whatever the time: its census is missing or unread, or its
 * rows cannot be counted as the owner's whole population. The shell asks on these alone ({@link readingEventReasonOf}).
 */
export type ReadingEventReason = "no-census" | "census-unread" | PopulationGap;

/**
 * Why the console takes a reading of its own: a reading event, no reading to show at all, or — on the Pull requests
 * page only, the one place a clock runs — the reading shown coming due against the cadence.
 */
export type RefreshReason = "due" | "no-reading" | ReadingEventReason;

/**
 * The instant the count on screen is aged from: the earliest of the reading's own and every census's start.
 *
 * The reading's instant is taken AFTER the verb's reads, so a census page asked for minutes earlier is older than
 * it; ageing from the earliest never calls the count younger than its oldest datum.
 *
 * @param observedAtIso when the reading says it was true of GitHub
 * @param census the reading's census, `undefined` on a document older than the field
 * @returns the earliest instant, as ISO
 */
export function countAgedFromOf({
  observedAtIso,
  census,
}: {
  observedAtIso: string;
  census: readonly LandingRepoCensus[] | undefined;
}): string {
  let earliest = observedAtIso;
  if (census === undefined) {
    return earliest;
  }
  for (const repo of census) {
    if (repo.kind === "read" && Date.parse(repo.startedAtIso) < Date.parse(earliest)) {
      earliest = repo.startedAtIso;
    }
  }
  return earliest;
}

/**
 * Whether the reading shown has come due against the landing cadence — within {@link REFRESH_HEADROOM_MINUTES} of it,
 * so the new one lands before the old one passes it. The shell asks this on every page while the console is in view
 * (`landingShellAskOf`).
 *
 * @param observedAtIso the instant the reading's count is aged from (`countAgedFromOf`)
 * @param nowMs the instant the shell is asking at
 * @returns true when it is due, or its instant cannot be read
 */
export function landingDueOf({ observedAtIso, nowMs }: { observedAtIso: string; nowMs: number }): boolean {
  const observedMs = Date.parse(observedAtIso);
  const dueAfterMs = (LANDING_CADENCE_MINUTES - REFRESH_HEADROOM_MINUTES) * 60_000;
  return Number.isNaN(observedMs) || nowMs - observedMs > dueAfterMs;
}

/**
 * Why the reading shown calls for a fresh one by what it is, or nothing when it will do — never by its age alone, which
 * is {@link landingDueOf}'s and the Pull requests page's.
 *
 * @param observedAtIso the instant the reading's count is aged from, which times the console's own reading's backoff
 * @param by who took it
 * @param census the reading's census, `undefined` on a document older than the field
 * @param selection what the reading was taken over: a selected repository the census carries no entry for is an unread
 *   census as much as an entry saying so, since GitHub's list for it was never read into the document
 * @param gap why its rows cannot be counted as the whole population, from `pullRequestPopulationOf`; judged after the
 *   census, under the same backoff on the console's own reading
 * @param nowMs the instant the console is asking at
 * @returns the reason, or `undefined`
 */
export function readingEventReasonOf({
  observedAtIso,
  by,
  census,
  selection,
  gap,
  nowMs,
}: {
  observedAtIso: string;
  by: string;
  census: readonly LandingRepoCensus[] | undefined;
  selection: LandingSelection | undefined;
  gap: PopulationGap | undefined;
  nowMs: number;
}): ReadingEventReason | undefined {
  // The console's own reading is retried only once the backoff has passed since it was taken: each run records a NEW
  // reading, so the per-reading backoff alone would let a census GitHub will not give loop.
  const observedMs = Date.parse(observedAtIso);
  if (by === SYNC_NOW_BY && !Number.isNaN(observedMs) && nowMs - observedMs < AUTO_RETRY_MINUTES * 60_000) {
    return undefined;
  }
  if (census === undefined) {
    return "no-census";
  }
  const censused = new Set(census.map((repo) => repo.repo));
  let selected: readonly string[] = [];
  if (selection !== undefined) {
    selected = selection.repos;
  }
  if (census.some((repo) => repo.kind === "unread") || selected.some((repo) => !censused.has(repo))) {
    return "census-unread";
  }
  return gap;
}

/**
 * The words the page prints for a reading it took itself.
 *
 * @returns the clause, e.g. "the reading shown was 25 minutes old or more, against the 30-minute landing cadence"
 */
export function refreshReasonWords({ reason }: { reason: RefreshReason }): string {
  if (reason === "due") {
    const at = LANDING_CADENCE_MINUTES - REFRESH_HEADROOM_MINUTES;
    return `the reading shown was ${String(at)} minutes old or more, against the ${String(LANDING_CADENCE_MINUTES)}-minute landing cadence`;
  }
  if (reason === "no-reading") {
    return "the page had no landing reading it could show";
  }
  if (reason === "no-census") {
    return "the reading shown predates GitHub's own open count";
  }
  if (reason === "drafts-excluded") {
    return "the reading shown left drafts out, so the console is taking one with drafts included";
  }
  if (reason === "rows-short") {
    return "GitHub's open list and the reading's rows did not reconcile, so the console is taking a fresh reading";
  }
  return "the reading shown did not read GitHub's open list for every repository it was taken over";
}
