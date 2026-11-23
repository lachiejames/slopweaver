/**
 * The ONE population the Pull requests page lists by default and its sidebar badge counts: the landing reading's
 * rows in this work context, drafts included. Pure.
 *
 * The badge and the list must count the same thing, drafts included, by default. So the badge's number is the number of cards Everything lists, never GitHub's census: the census
 * (`./pullRequestCensus.ts`) is the same document's witness that the rows ARE every open pull request of the owner's, and the
 * explanation when they are not. A count is printed only when the reading was taken with drafts, its census read,
 * is inside the landing cadence, and names no open pull request of the owner's the rows do not carry and no row GitHub no
 * longer lists open. Otherwise the rows stay drawn, no number is printed anywhere, and an empty list says why rather
 * than a confident zero (an explanation is better than nothing when GitHub has open pull requests).
 */

import type { LandingReading, LandingRepoCensus, LandingRow, LandingSelection } from "../components/live/readLanding";
import { countAgedFromOf, LANDING_CADENCE_MINUTES, type PopulationGap } from "./landingFreshness";
import { prKeyOf } from "./prViews";
import { type CensusPicture, censusPictureOf, currentCensusOf, matchesAuthor, populationOf } from "./pullRequestCensus";
import type { ReasonWords } from "./quotedReason";
import { prPlacement } from "./registerPlacementDirect";
import type { SidebarCount } from "./sidebarCountsBasis";
import type { WorkContext } from "./workContext";
import type { WorkspacePlacer } from "./workspacePlacement";
import { shownInContext } from "./workspacePlacementContext";

/** The population, counted, or why no number may be printed for it. Its rows are drawn either way. */
export type PullRequestPopulation =
  | {
      readonly phase: "measured";
      /** The rows Everything lists in this context, in the reading's own order. */
      readonly rows: readonly LandingRow[];
      readonly picture: Extract<CensusPicture, { readonly kind: "counted" }>;
      /** `rows.length`, with what it counts in words — the badge prints exactly this. */
      readonly count: SidebarCount;
    }
  | {
      readonly phase: "not-measured";
      readonly rows: readonly LandingRow[];
      readonly picture: CensusPicture;
      /** The console's own words, or each read reason it quotes, kept apart for the fold (steer 7). */
      readonly why: ReasonWords;
      /** The gap a fresh reading repairs, when the census read; `undefined` when the census itself is the reason. */
      readonly gap: PopulationGap | undefined;
    };

/**
 * The sentence a draft-free reading's population says: a fact only. What the console is doing about it is said beside
 * it off the refresh's own state (`landingRefreshPlanOf`), never promised here.
 */
const DRAFTS_EXCLUDED_WHY =
  "the reading shown was taken without drafts, so it cannot count every open pull request of yours";

/** How far the rows drawn here are from GitHub's own open list, one tally per way they can differ. */
interface Mismatch {
  /** A row repeating a pull request an earlier row already carries. */
  duplicate: number;
  /** A row in a repository the census holds no readable entry for. */
  uncensused: number;
  /** A row in a censused repository whose open list no longer carries it. */
  closed: number;
  /** A row GitHub lists open, but by an author the reading's `--author` does not cover. */
  outsideAuthor: number;
  /** One of the owner's open pull requests in this context that no row carries. */
  missing: number;
}

/**
 * The ONE reconciliation rule the count stands on (piecemeal checks each left another hole): the rows drawn in this context, as a MULTISET of repo#number keys, must equal EXACTLY the set of
 * the owner's open pull requests the census lists for this context — every key once, every row's repository read. Anything
 * else is tallied by kind, so the sentence can say which. A census pull request the reading carries but places in
 * another context is expected THERE, never here: that is a placement fact a fresh reading would not move.
 *
 * @param census the reading's census, read for every selected repository in this context (`censusPictureOf` said so)
 * @param selection what the reading was taken over, whose `--author` decides whose pull requests are expected
 * @param drawn the rows drawn in this context, which the badge would count
 * @param every every row the reading carries, which decides where a census pull request it carries is expected
 * @param context the context the console is being looked at in
 * @param placer the organisation's address readers
 * @returns the tallies; all zero exactly when the rows reconcile
 */
function mismatchOf({
  census,
  selection,
  drawn,
  every,
  context,
  placer,
}: {
  census: readonly LandingRepoCensus[];
  selection: LandingSelection;
  drawn: readonly LandingRow[];
  every: readonly LandingRow[];
  context: WorkContext;
  placer: WorkspacePlacer;
}): Mismatch {
  const drawnKeys = new Set(drawn.map((row) => prKeyOf({ row })));
  const carriedKeys = new Set(every.map((row) => prKeyOf({ row })));
  const readRepos = new Set<string>();
  const listedOpen = new Set<string>();
  const expected = new Set<string>();
  for (const repo of census) {
    if (repo.kind !== "read") {
      continue;
    }
    readRepos.add(repo.repo);
    const repoHere = shownInContext({ context, placement: placer.repositoryPlacement({ repo: repo.repo }) });
    for (const pr of repo.pullRequests) {
      const key = prKeyOf({ row: { number: pr.number, repoSlug: repo.repo } });
      listedOpen.add(key);
      if (!matchesAuthor({ author: pr.author, selected: selection.author, viewer: repo.viewer })) {
        continue;
      }
      // A pull request the reading carries is expected where its row is drawn; one it does not, where its repository is.
      let here = repoHere;
      if (carriedKeys.has(key)) {
        here = drawnKeys.has(key);
      }
      if (here) {
        expected.add(key);
      }
    }
  }
  const tally: Mismatch = { closed: 0, duplicate: 0, missing: 0, outsideAuthor: 0, uncensused: 0 };
  const seen = new Set<string>();
  for (const row of drawn) {
    const key = prKeyOf({ row });
    if (seen.has(key)) {
      tally.duplicate += 1;
      continue;
    }
    seen.add(key);
    if (expected.has(key)) {
      continue;
    }
    if (!readRepos.has(row.repoSlug)) {
      tally.uncensused += 1;
    } else if (listedOpen.has(key)) {
      tally.outsideAuthor += 1;
    } else {
      tally.closed += 1;
    }
  }
  tally.missing = [...expected].filter((key) => !seen.has(key)).length;
  return tally;
}

/**
 * The sentence for a reading whose rows do not reconcile, naming each way they differ.
 *
 * @param mismatch the tallies from {@link mismatchOf}
 * @param authorFilter the reading's `--author`, which names whose pull requests are missing
 * @returns the sentence, or `undefined` when every tally is zero
 */
function rowsShortOf({
  mismatch,
  authorFilter,
}: {
  mismatch: Mismatch;
  authorFilter: string | undefined;
}): string | undefined {
  const parts: string[] = [];
  if (mismatch.duplicate > 0) {
    parts.push(`${String(mismatch.duplicate)} of its rows repeat a pull request another row already carries`);
  }
  if (mismatch.missing > 0) {
    const whose = populationOf({ authorFilter });
    parts.push(`GitHub lists ${String(mismatch.missing)} of ${whose} here that none of its rows carries`);
  }
  if (mismatch.closed > 0) {
    parts.push(`${String(mismatch.closed)} of its rows GitHub no longer lists open`);
  }
  if (mismatch.uncensused > 0) {
    parts.push(`${String(mismatch.uncensused)} of its rows are in a repository whose open list it did not read`);
  }
  if (mismatch.outsideAuthor > 0) {
    parts.push(`${String(mismatch.outsideAuthor)} of its rows are by an author the reading was not taken over`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return `the reading shown does not reconcile with GitHub's open list: ${parts.join(", and ")}`;
}

/**
 * The census entries for the repositories one context shows. Only these can age that context's count: a census
 * entry for a repository the context does not draw changes none of its rows, exactly as an unread one does not
 * (`censusPictureOf` filters the same way), so an old read of another workspace never withholds this one's number.
 *
 * @param census the reading's census, `undefined` on a document older than the field
 * @returns the entries this context shows, or `undefined` when the reading carries no census
 */
function censusInContextOf({
  census,
  context,
  placer,
}: {
  census: readonly LandingRepoCensus[] | undefined;
  context: WorkContext;
  placer: WorkspacePlacer;
}): readonly LandingRepoCensus[] | undefined {
  if (census === undefined) {
    return undefined;
  }
  return census.filter((repo) =>
    shownInContext({ context, placement: placer.repositoryPlacement({ repo: repo.repo }) }),
  );
}

/**
 * The population for one reading in one work context: its rows, and either their count or why there is none.
 *
 * @param reading the landing reading the page and the badge both draw from
 * @param context the context the console is being looked at in
 * @param placer the organisation's address readers, which say which workspace a pull request is in
 * @param nowMs the instant it is drawn at, which ages the census against the landing cadence
 * @returns the population
 */
export function pullRequestPopulationOf({
  reading,
  context,
  placer,
  nowMs,
}: {
  reading: LandingReading;
  context: WorkContext;
  placer: WorkspacePlacer;
  nowMs: number;
}): PullRequestPopulation {
  const { census, rows: every, selection } = reading.landing;
  const rows = every.filter((row) => shownInContext({ context, placement: prPlacement({ placer, row }) }));
  // The gaps a fresh reading repairs are read off the reading's OWN contents, whatever its age: aged first, an old
  // reading whose census shows rows missing would name only its age, and the shell — which asks on a gap, never on
  // age — would never repair it. Age only withholds the count, below.
  const contents = censusPictureOf({ census, context, drawn: rows, placer, rows: every, selection });
  const picture = currentCensusOf({
    nowMs,
    observedAtIso: countAgedFromOf({
      census: censusInContextOf({ census, context, placer }),
      observedAtIso: reading.observedAtIso,
    }),
    picture: contents,
  });
  // A reading that does not say it read drafts cannot prove it did merely because none happened to appear.
  const draftsExcluded = selection === undefined || !selection.includeDrafts;
  let draftsGap: PopulationGap | undefined;
  if (draftsExcluded) {
    draftsGap = "drafts-excluded";
  }
  if (contents.kind === "unavailable") {
    return { gap: draftsGap, phase: "not-measured", picture, rows, why: contents.why };
  }
  if (draftsExcluded) {
    return { gap: "drafts-excluded", phase: "not-measured", picture, rows, why: DRAFTS_EXCLUDED_WHY };
  }
  // `censusPictureOf` counted, so the reading carries a census.
  const mismatch = mismatchOf({ census: census!, context, drawn: rows, every, placer, selection });
  const short = rowsShortOf({ authorFilter: contents.authorFilter, mismatch });
  if (short !== undefined) {
    return { gap: "rows-short", phase: "not-measured", picture, rows, why: short };
  }
  if (picture.kind === "unavailable") {
    return { gap: undefined, phase: "not-measured", picture, rows, why: picture.why };
  }
  return {
    count: {
      count: rows.length,
      title: `${populationOf({ authorFilter: picture.authorFilter })} in this context, drafts included: the cards the Pull requests page lists under Everything`,
    },
    phase: "measured",
    picture,
    rows,
  };
}

/**
 * The instant the sidebar badge must next draw itself for one reading, so its number is withdrawn AT the landing
 * cadence (`currentCensusOf`) and not at whatever render happens next. It is the only time-dependent input to what
 * the badge shows: the backoff decides runs, never a drawing. DISPLAY ONLY — nothing that decides whether the console
 * takes a reading reads it.
 *
 * @param reading the landing reading the badge counts
 * @param context the context the badge counts in, whose repositories alone age its count
 * @param placer the organisation's address readers, which say which workspace a repository is in
 * @param nowMs the badge's own clock
 * @returns the first millisecond the count is withheld for age, or `undefined` once that is behind the clock, or when
 *   the reading's instant cannot be read (its count is withheld already)
 */
export function badgeRedrawAtOf({
  reading,
  context,
  placer,
  nowMs,
}: {
  reading: LandingReading;
  context: WorkContext;
  placer: WorkspacePlacer;
  nowMs: number;
}): number | undefined {
  const census = censusInContextOf({ census: reading.landing.census, context, placer });
  const fromMs = Date.parse(countAgedFromOf({ census, observedAtIso: reading.observedAtIso }));
  if (Number.isNaN(fromMs)) {
    return undefined;
  }
  const withheldAtMs = fromMs + LANDING_CADENCE_MINUTES * 60_000 + 1;
  if (withheldAtMs <= nowMs) {
    return undefined;
  }
  return withheldAtMs;
}
