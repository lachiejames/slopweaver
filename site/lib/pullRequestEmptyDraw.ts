/**
 * What the Pull requests page and its sidebar badge stand on once the population is read: whether the latest read
 * answered, the ONE rule for printing a count, and what the cards' plane draws when the state it is on holds no card.
 * Pure. The population itself is `./pullRequestPopulation.ts`; this is what an empty or uncounted list says about it.
 */

import type { SyncState } from "../components/live/LandingSync";
import type { LiveState } from "./liveState";
import type { PrView } from "./prViews";
import { populationOf } from "./pullRequestCensus";
import type { PullRequestPopulation } from "./pullRequestPopulation";
import type { QuotedReason, ReasonWords } from "./quotedReason";
import type { SidebarCount } from "./sidebarCountsBasis";

/**
 * Whether the latest read of what an empty list stands on answered, or why the reading shown proves nothing now: a
 * read's own reason is quoted apart from the console's lead, never set inside it (steer 7).
 */
export type EmptyLatest = { readonly phase: "current" } | { readonly phase: "not-current"; readonly why: ReasonWords };

/**
 * One reading's latest read, as an empty list judges it: a value kept over a failed read, or handed over while its
 * replacement is read, is not proof of anything now (`provenNowOf`, `./pageEmpty.ts`).
 *
 * @param state the reading
 * @param subject what it is a reading of, in the sentence
 * @returns current, or why not
 */
export function emptyLatestOf({ state, subject }: { state: LiveState<unknown>; subject: string }): EmptyLatest {
  if (state.phase === "ready" && state.stale !== undefined) {
    return { phase: "not-current", why: [{ lead: `the latest read of ${subject} failed`, why: state.stale.why }] };
  }
  if (state.phase === "ready" && state.refreshing === true) {
    return { phase: "not-current", why: `${subject} are being read again` };
  }
  if (state.phase === "ready") {
    return { phase: "current" };
  }
  if (state.phase === "not-measured") {
    return { phase: "not-current", why: [{ lead: `${subject} could not be read`, why: state.why }] };
  }
  return { phase: "not-current", why: `${subject} are still being read` };
}

/** The number the badge and the page's selector may print, or why neither prints one. */
export type PullRequestCount =
  | { readonly phase: "counted"; readonly count: SidebarCount }
  | { readonly phase: "withheld"; readonly why: ReasonWords };

/**
 * The ONE rule for whether a count of the population is printed, which the sidebar badge and the page's selector both
 * call: the landing reading's latest read answered — not a reading kept over a failed read, nor one handed over while
 * its replacement is read, nor one the console's own refresh just failed to replace — and the population is measured.
 * A retained reading's rows stay drawn; its number does not.
 *
 * @param latest the landing reading's latest read and the console's latest refresh, from {@link landingLatestOf}
 * @param population the population it counts
 * @returns the count, or why there is none
 */
export function pullRequestCountOf({
  latest,
  population,
}: {
  latest: EmptyLatest;
  population: PullRequestPopulation;
}): PullRequestCount {
  if (latest.phase === "not-current") {
    return { phase: "withheld", why: latest.why };
  }
  if (population.phase === "not-measured") {
    return { phase: "withheld", why: population.why };
  }
  return { count: population.count, phase: "counted" };
}

/**
 * The landing reading's latest read as the badge and the page both judge it: {@link emptyLatestOf}, and not current
 * either while the console's own latest refresh over the reading shown FAILED — the reading on screen then looks
 * current only because nothing replaced it, so no number and no designed zero stand on it. A later
 * reading clears it, because the runner stops reporting a failure once another reading is shown
 * (`syncShownOf`, `./landingAutoRefresh.ts`).
 *
 * @param state the landing reading
 * @param sync where the console's own landing refresh stands, as the runner reports it for the reading shown
 * @returns current, or why not
 */
export function landingLatestOf({ state, sync }: { state: LiveState<unknown>; sync: SyncState }): EmptyLatest {
  const latest = emptyLatestOf({ state, subject: "your pull requests" });
  if (latest.phase === "current" && sync.phase === "failed") {
    return {
      phase: "not-current",
      why: [{ lead: "the console's latest refresh of your pull requests failed", why: sync.why }],
    };
  }
  return latest;
}

/** How the cards' plane draws a state that holds no card. */
export type PullRequestEmptyDraw =
  | { readonly kind: "none" }
  | { readonly kind: "designed"; readonly title: string; readonly appearsWhen: string }
  | {
      readonly kind: "explanation";
      readonly title: string;
      /** The console's own sentence, when the reason is all its own words; `undefined` when it quotes reads instead. */
      readonly detail: string | undefined;
      /** Each read reason it stands on, the first led by "Not a count of zero", drawn through `PlainWhy` (steer 7). */
      readonly quoted: readonly QuotedReason[];
    };

/**
 * An empty state that cannot be proven empty, explained: its own sentence when the reason is the console's own, else
 * each quoted read reason on its own line, the first carrying "Not a count of zero" so the line still says it.
 *
 * @param why the reason, from the latest read or the population
 * @returns the explanation
 */
function explanationOf({ title, why }: { title: string; why: ReasonWords }): PullRequestEmptyDraw {
  if (typeof why === "string") {
    return { detail: `Not a count of zero: ${why}.`, kind: "explanation", quoted: [], title };
  }
  const quoted = why.map((reason, at) => {
    if (at > 0) {
      return { lead: reason.lead, why: reason.why };
    }
    return { lead: `Not a count of zero: ${reason.lead}`, why: reason.why };
  });
  return { detail: undefined, kind: "explanation", quoted, title };
}

/**
 * What the plane draws when the state the selector is on holds no card. Only a current reading of a counted
 * population draws the designed empty state — a filter that matches nothing included, which is a filter result and
 * never a claim that nothing is open. Anything else explains itself, naming GitHub's own count when the census has
 * one, never a zero.
 *
 * @param viewedCount the cards the state holds
 * @param view the state, with its words
 * @param population the population the state narrows
 * @param latest whether the readings the state stands on answered their latest read
 * @returns what to draw
 */
export function pullRequestEmptyDrawOf({
  viewedCount,
  view,
  population,
  latest,
}: {
  viewedCount: number;
  view: { readonly key: PrView; readonly label: string };
  population: PullRequestPopulation;
  latest: EmptyLatest;
}): PullRequestEmptyDraw {
  if (viewedCount > 0) {
    return { kind: "none" };
  }
  let title = `This reading cannot show there is nothing under ${view.label}.`;
  if (population.picture.kind === "counted" && population.picture.open > 0) {
    const whose = populationOf({ authorFilter: population.picture.authorFilter });
    title = `GitHub lists ${String(population.picture.open)} of ${whose} in this context, and this reading shows none under ${view.label}.`;
  }
  if (latest.phase === "not-current") {
    return explanationOf({ title, why: latest.why });
  }
  if (population.phase === "not-measured") {
    return explanationOf({ title, why: population.why });
  }
  return {
    appearsWhen: `A pull request appears here when the latest GitHub reading places it under ${view.label}.`,
    kind: "designed",
    title: `Pull requests under ${view.label} will appear here.`,
  };
}
