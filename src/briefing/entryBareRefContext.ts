/**
 * Which repository a bare `#N` in one briefing ENTRY means — a react-now card, or one note below the line —
 * as the page check (`./bareRef.ts`) reads it. The form writer (`./qualifyBareRefs.ts`) never applies this rule
 * itself: it asks the check, over the note rendered, so the two cannot disagree about what resolved.
 *
 * ## Why the entry and not the page
 *
 * MEASURED on a supervisor seat's tick: `supervisor tick close` refused the page with about sixty
 * bare `#<number>` findings, every one in a "done since you last looked" note twenty earlier ticks had passed.
 * The page context was built from every GitHub link on the page, and that tick's page newly linked a pull request
 * in a second repository from an unrelated row, so no single repository resolved anything anywhere. Reproduce
 * the class with `slopweaver briefing check <tick-dir>/page.fragment.refused.html` over any page whose rows link
 * two repositories while a note carries a bare `#N`.
 *
 * So a bare reference resolves against the repository of the NEAREST full GitHub link in its own entry, and
 * only an entry carrying no link of its own falls back to the page's context — where two repositories is still
 * the honest ambiguity `../outbound/linkify/bareRefs.ts` refuses. Two links to different repositories at the
 * SAME distance is a tie this does not break: the reference resolves against nothing and is refused.
 *
 * Distance is measured in the entry's visible text — tags as spaces, whitespace collapsed, exactly as the page
 * reads — with each link standing as a POINT, its label excluded.
 *
 * Every attestation, the page's and the entry's, is kept when the repository narrows, so a five-digit number
 * beside a three-digit repository's link is still refused by magnitude rather than resolved into it.
 */
import type { AttestedNumber, BareRefContext, RepoRef } from "../outbound/linkify/bareRefs.js";

/** One full GitHub link inside an entry: where it stands in the entry's visible text, and what it names. */
export interface EntryRepoAnchor {
  /** The link's position in the entry's visible text, its own label excluded. */
  readonly at: number;
  readonly repo: RepoRef;
  /** The object numbers the link proves exist in its repository. */
  readonly attested: readonly AttestedNumber[];
}

/** How far a link standing at `at` is from the reference spanning `start`..`end`. */
function distance({ at, start, end }: { at: number; start: number; end: number }): number {
  if (at <= start) {
    return start - at;
  }
  return at >= end ? at - end : 0;
}

/**
 * The repositories of the links nearest a reference, deduplicated — one entry when the nearest link is
 * unambiguous, two or more on a tie between different repositories.
 */
function nearestRepos({
  anchors,
  start,
  end,
}: {
  anchors: readonly EntryRepoAnchor[];
  start: number;
  end: number;
}): readonly RepoRef[] {
  const best = Math.min(...anchors.map((anchor) => distance({ at: anchor.at, end, start })));
  const repos = new Map<string, RepoRef>();
  for (const anchor of anchors) {
    if (distance({ at: anchor.at, end, start }) === best) {
      repos.set(`${anchor.repo.owner}/${anchor.repo.repo}`, anchor.repo);
    }
  }
  return [...repos.values()];
}

/**
 * The context a bare reference at `start`..`end` in one entry resolves against: the page's context with its
 * repositories narrowed to the nearest link's in that entry, or the page's context unchanged when the entry
 * carries no GitHub link.
 *
 * @param anchors every full GitHub link in the entry, positioned in its visible text
 * @param fallback the page's own context, used whole when the entry links nothing
 * @param start where the reference begins in the entry's visible text
 * @param end where it ends
 * @returns the context to resolve the reference against; on a tie between two repositories, one naming none
 */
export function bareRefContextAt({
  anchors,
  fallback,
  start,
  end,
}: {
  anchors: readonly EntryRepoAnchor[];
  fallback: BareRefContext;
  start: number;
  end: number;
}): BareRefContext {
  if (anchors.length === 0) {
    return fallback;
  }
  const nearest = nearestRepos({ anchors, end, start });
  const fromEntry = anchors.flatMap((anchor) => anchor.attested);
  // A page with no magnitude evidence omits `attested`; the entry's links then attest alone.
  const attested = fallback.attested === undefined ? fromEntry : [...fallback.attested, ...fromEntry];
  return { ...fallback, attested, repos: nearest.length === 1 ? nearest : [] };
}
