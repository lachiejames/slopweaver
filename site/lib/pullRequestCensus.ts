/**
 * GitHub's own count of the OWNER's open pull requests in this context, reconciled with the landing reading's rows: how many
 * are open on GitHub, how many a row carries, and every one no row does — each named, with why. It is the same
 * document's witness that the rows the Pull requests page lists and its badge counts (`./pullRequestPopulation.ts`)
 * are every open pull request of the owner's, and the explanation when they are not; it is never itself the badge's
 * number, because the badge and the list must not count two different things.
 *
 * The page's numbers must always match GitHub's `/pulls`: the page showed ONE open slopweaver pull request of the
 * owner's while GitHub's `/pulls` showed 17. So the landing document carries GitHub's own open list beside its
 * rows — the census, `src/live/github/openCensus.ts`, every author — and this module is the whole of the arithmetic.
 *
 * The badge counts the owner's own open pull requests, never the organisation's every open pull request: it read 406
 * under Acme when the owner had about thirty on the acme-admin repo. So the population is the census
 * pull requests the reading's own `--author` qualifier matches, drafts included, because GitHub's
 * `is:open author:@me` includes them: `open` is that count, `placed` is the ones a row carries, `notPlaced` is
 * every other one, so `open === placed + notPlaced.length` by construction, and `otherAuthors` counts the rest of
 * the census outside that equation. MEASURED with `slopweaver reading last --producer "github
 * landing" --json`: acme-admin 390 open, 23 the owner's; slopweaver 6 open, 5 the owner's. Nothing here is a second opinion about
 * a row.
 *
 * Pure: the census, the selection, the rows and the context in, the picture out.
 */

import type { LandingCensusPr, LandingRepoCensus, LandingRow, LandingSelection } from "../components/live/readLanding";
import { LANDING_CADENCE_MINUTES } from "./landingFreshness";
import type { QuotedRead } from "./quotedReason";
import type { WorkContext } from "./workContext";
import type { WorkspacePlacement, WorkspacePlacer } from "./workspacePlacement";
import { findingLabel, shownInContext } from "./workspacePlacementContext";

/** Why one of the owner's pull requests GitHub lists open is not in any group on the page. */
export type NotPlacedReason = "draft-excluded" | "not-in-reading" | "filtered-here";

/** One open pull request the reading did not place. */
export interface NotPlacedPr extends LandingCensusPr {
  readonly repoSlug: string;
  readonly reason: NotPlacedReason;
}

/** The pull requests one reason covers, and the sentence the page prints for it. */
export interface NotPlacedGroup {
  readonly reason: NotPlacedReason;
  readonly sentence: string;
  readonly prs: readonly NotPlacedPr[];
}

/**
 * GitHub's count for this context, or why it cannot give one: the console's own words, or each repository's read
 * reason it quotes.
 */
export type CensusPicture =
  | { readonly kind: "unavailable"; readonly why: string | readonly QuotedRead[] }
  | {
      readonly kind: "counted";
      /** The open pull requests GitHub lists over this context's repositories that the reading's author qualifier matches. */
      readonly open: number;
      /** The reading's `--author` qualifier as recorded, `@me` included; `undefined` when it took every author. */
      readonly authorFilter: string | undefined;
      /** Open pull requests in the census the qualifier does not match — outside `open`, never not placed. */
      readonly otherAuthors: number;
      /** How many of those a landing row carries. */
      readonly placed: number;
      readonly notPlaced: readonly NotPlacedPr[];
      /** Only the reasons that hold at least one pull request, in a fixed order. */
      readonly byReason: readonly NotPlacedGroup[];
      /** The repositories counted, in the selection's order. */
      readonly repos: readonly string[];
      /** Landing rows in this context GitHub no longer lists open — closed between the rows and the census. */
      readonly closedSince: number;
    };

/** The order the reasons print in: the reading's own exclusions first, then what it could not explain. */
const REASON_ORDER: readonly NotPlacedReason[] = ["draft-excluded", "not-in-reading", "filtered-here"];

/** How many numbers a reason's line names inline before it leaves the rest to the fold. */
export const INLINE_NUMBERS = 10;

/** One pull request's key, across repositories: a number alone is not unique. */
function keyOf({ repo, number }: { repo: string; number: number }): string {
  return `${repo}#${String(number)}`;
}

/**
 * Whether an author qualifier is GitHub's `@me`, in any case — the CLI records `--author` as typed.
 *
 * @returns true when the qualifier means the token's own user
 */
function isViewerQualifier({ selected }: { selected: string }): boolean {
  return selected.toLowerCase() === "@me";
}

/**
 * Whether the reading's author qualifier matches a pull request's author — whether it is in the counted population.
 *
 * `@me` is GitHub's own spelling of the token's user, which the census names as its `viewer` on the same read;
 * logins compare case-insensitively because GitHub's do. A deleted author matches no qualifier, and a reading
 * with no qualifier matches every author.
 *
 * @returns true when the pull request is one the reading's `--author` covers
 */
export function matchesAuthor({
  author,
  selected,
  viewer,
}: {
  author: string | undefined;
  selected: string | undefined;
  viewer: string;
}): boolean {
  if (selected === undefined) {
    return true;
  }
  if (author === undefined) {
    return false;
  }
  let wanted = selected;
  if (isViewerQualifier({ selected })) {
    wanted = viewer;
  }
  return author.toLowerCase() === wanted.toLowerCase();
}

/**
 * The line the page prints for one reason, in the reading's own terms.
 *
 * @returns the sentence, without the count
 */
function sentenceOf({ reason }: { reason: NotPlacedReason }): string {
  if (reason === "draft-excluded") {
    return "draft: this reading was taken without --include-drafts";
  }
  if (reason === "filtered-here") {
    return "in this reading but not drawn on this page";
  }
  return "open on GitHub but in none of this reading's rows: opened after it, or past its --limit";
}

/**
 * GitHub's count for one context: its own open pull requests the reading's `--author` matches, with every one of
 * those the reading did not place named, and the rest of the census counted apart.
 *
 * No count is printed from a partial census: a reading with no census, or one where a repository in this
 * context could not be read, is `unavailable` with the reason, never a sum over the repositories that did read.
 *
 * @param census the document's census, `undefined` on a document older than the field
 * @param selection what the reading was taken over
 * @param rows every landing row in the document, before any filter
 * @param drawn the rows the page draws in this workspace, whatever state is selected; a row in the reading but not
 *   among them is named as `filtered-here`, never counted as placed below
 * @param context the context the console is being looked at in
 * @param placer the organisation's address readers, which say which workspace a repository is in
 * @returns the picture
 */
export function censusPictureOf({
  census,
  selection,
  rows,
  drawn,
  context,
  placer,
}: {
  census: readonly LandingRepoCensus[] | undefined;
  selection: LandingSelection | undefined;
  rows: readonly LandingRow[];
  drawn: readonly LandingRow[];
  context: WorkContext;
  placer: WorkspacePlacer;
}): CensusPicture {
  if (census === undefined) {
    return {
      kind: "unavailable",
      why: "this reading predates the verb recording GitHub's own open count, so no count is claimed",
    };
  }
  // With no recorded selection there is nothing to check the census's coverage against, so no count is claimed.
  if (selection === undefined) {
    return {
      kind: "unavailable",
      why: "this reading records no repository selection, so its census cannot be checked against one and no count is claimed",
    };
  }
  const here = census.filter((repo) =>
    shownInContext({ context, placement: placer.repositoryPlacement({ repo: repo.repo }) }),
  );
  // A census missing a repository the reading was taken over would print that repository's share as zero.
  const censused = new Set(census.map((repo) => repo.repo));
  const missing = selection.repos.filter(
    (repo) => shownInContext({ context, placement: placer.repositoryPlacement({ repo }) }) && !censused.has(repo),
  );
  // And one counting a repository the reading was NOT taken over would add a count nobody asked for.
  const extra = here.filter((repo) => !selection.repos.includes(repo.repo)).map((repo) => repo.repo);
  if (extra.length > 0) {
    return {
      kind: "unavailable",
      why: `this reading's census counts ${extra.join(", ")}, which the reading was not taken over, so no count is claimed`,
    };
  }
  if (missing.length > 0) {
    return {
      kind: "unavailable",
      why: `this reading was taken over ${missing.join(", ")} but its census does not count it, so no count is claimed`,
    };
  }
  if (here.length === 0) {
    return { kind: "unavailable", why: "this reading counted no repository in this context" };
  }
  // Each repository's reason stays exactly as the read gave it, under the console's own lead (steer 7).
  const unread = here.flatMap((repo): QuotedRead[] => {
    if (repo.kind !== "unread") {
      return [];
    }
    const subject = `GitHub's open list for ${repo.repo}`;
    return [{ lead: `${subject} could not be read`, subject, why: repo.why }];
  });
  if (unread.length > 0) {
    return { kind: "unavailable", why: unread };
  }
  const rowKeys = new Set(rows.map((row) => keyOf({ number: row.number, repo: row.repoSlug })));
  const drawnKeys = new Set(drawn.map((row) => keyOf({ number: row.number, repo: row.repoSlug })));
  const listed = new Set<string>();
  const notPlaced: NotPlacedPr[] = [];
  let open = 0;
  let otherAuthors = 0;
  let placed = 0;
  for (const repo of here) {
    if (repo.kind !== "read") {
      continue;
    }
    for (const pr of repo.pullRequests) {
      const key = keyOf({ number: pr.number, repo: repo.repo });
      // Every census key is still open on GitHub, so a row carrying one is never closed since, whoever wrote it.
      listed.add(key);
      // The author filter comes before placement, so a row outside the population can never count as placed.
      if (!matchesAuthor({ author: pr.author, selected: selection.author, viewer: repo.viewer })) {
        otherAuthors += 1;
        continue;
      }
      open += 1;
      if (drawnKeys.has(key)) {
        placed += 1;
        continue;
      }
      if (rowKeys.has(key)) {
        notPlaced.push({ ...pr, reason: "filtered-here", repoSlug: repo.repo });
        continue;
      }
      let reason: NotPlacedReason = "not-in-reading";
      if (pr.isDraft && !selection.includeDrafts) {
        reason = "draft-excluded";
      }
      notPlaced.push({ ...pr, reason, repoSlug: repo.repo });
    }
  }
  const byReason = REASON_ORDER.flatMap((reason) => {
    const prs = notPlaced.filter((pr) => pr.reason === reason);
    if (prs.length === 0) {
      return [];
    }
    return [{ prs, reason, sentence: sentenceOf({ reason }) }];
  });
  const counted = new Set(here.map((repo) => repo.repo));
  // Closed since is of the same population as `open`: a row the author qualifier does not match is not the owner's to count.
  const viewers = new Map(here.flatMap((repo) => (repo.kind === "read" ? [[repo.repo, repo.viewer] as const] : [])));
  const closedSince = rows.filter((row) => {
    const viewer = viewers.get(row.repoSlug);
    return (
      viewer !== undefined &&
      matchesAuthor({ author: row.authorLogin, selected: selection.author, viewer }) &&
      !listed.has(keyOf({ number: row.number, repo: row.repoSlug }))
    );
  }).length;
  return {
    authorFilter: selection.author,
    byReason,
    closedSince,
    kind: "counted",
    notPlaced,
    open,
    otherAuthors,
    placed,
    repos: [...counted],
  };
}

/**
 * Whose open pull requests a count covers, in words: the badge's title and the headline both say it, so neither
 * calls a named author's or every author's count "yours".
 *
 * @param authorFilter the reading's `--author` qualifier as recorded
 * @returns e.g. `your open pull requests`, `open pull requests by x`, `open pull requests`
 */
export function populationOf({ authorFilter }: { authorFilter: string | undefined }): string {
  if (authorFilter === undefined) {
    return "open pull requests";
  }
  if (isViewerQualifier({ selected: authorFilter })) {
    return "your open pull requests";
  }
  return `open pull requests by ${authorFilter}`;
}

/**
 * The workspace findings among the pull requests only the census carries — open on GitHub, in a repository no
 * workspace owns, and on no landing row — so the page's findings figure counts them too. A pull request a
 * landing row carries is already in that figure through its row. A census pull request is placed by the repository
 * whose GitHub list carries it — the census reads each repository's own open list, so that repository IS its address,
 * and its link is that list's, never a second one to weigh against it.
 *
 * @param picture the census as the page draws it
 * @param placer the organisation's address readers, which say which workspace a repository is in
 * @returns one placement per such pull request, each a finding
 */
export function censusFindingsOf({
  picture,
  placer,
}: {
  picture: CensusPicture;
  placer: WorkspacePlacer;
}): readonly WorkspacePlacement[] {
  if (picture.kind !== "counted") {
    return [];
  }
  return picture.notPlaced
    .filter((pr) => pr.reason !== "filtered-here")
    .map((pr) => placer.repositoryPlacement({ repo: pr.repoSlug }))
    .filter((placement) => findingLabel({ placement }) !== undefined);
}

/**
 * The numbers a reason's line names inline: every one up to {@link INLINE_NUMBERS}, else that many and a count
 * of the rest, which the fold beneath lists whole.
 *
 * @returns the text, e.g. `#N, #9 and 3 more`
 */
export function inlineNumbersOf({ prs, multiRepo }: { prs: readonly NotPlacedPr[]; multiRepo: boolean }): string {
  const named = prs.slice(0, INLINE_NUMBERS).map((pr) => {
    if (multiRepo) {
      return `${pr.repoSlug.split("/").at(-1)!}#${String(pr.number)}`;
    }
    return `#${String(pr.number)}`;
  });
  const rest = prs.length - named.length;
  if (rest > 0) {
    return `${named.join(", ")} and ${String(rest)} more`;
  }
  return named.join(", ");
}

/**
 * The picture, or NOT MEASURED once the reading it was drawn from is past the landing cadence.
 *
 * The count is GitHub's, with a reading no older than the landing cadence. The page starts
 * its own reading before that (`landingFreshness.ts`), but a run can fail or be slow, so the number itself is
 * withdrawn at the cadence rather than left standing beside an ageing stamp. The rows stay drawn.
 *
 * @param picture what the reading counted
 * @param observedAtIso when the reading was true of GitHub
 * @param nowMs the instant the page is drawn at
 * @returns the picture, or `unavailable` naming the reading's age when it would have printed a count
 */
export function currentCensusOf({
  picture,
  observedAtIso,
  nowMs,
}: {
  picture: CensusPicture;
  observedAtIso: string;
  nowMs: number;
}): CensusPicture {
  const observedMs = Date.parse(observedAtIso);
  const cadenceMs = LANDING_CADENCE_MINUTES * 60_000;
  // A picture with no count already says why; its reason is the more specific fact than the reading's age.
  if (picture.kind === "unavailable" || (!Number.isNaN(observedMs) && nowMs - observedMs <= cadenceMs)) {
    return picture;
  }
  const cadence = String(LANDING_CADENCE_MINUTES);
  if (Number.isNaN(observedMs)) {
    return {
      kind: "unavailable",
      why: `this reading's instant cannot be read, so it cannot be shown to be inside the ${cadence}-minute landing cadence`,
    };
  }
  const minutes = String(Math.floor((nowMs - observedMs) / 60_000));
  return {
    kind: "unavailable",
    // A fact only: what the console is DOING about it is the badge's and the page's to say, off the refresh's own
    // state (`landingRefreshPlanOf`), since an age cannot prove a refresh is running.
    why: `the reading it counts is ${minutes} minutes old, past the ${cadence}-minute landing cadence`,
  };
}
