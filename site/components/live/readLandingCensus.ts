/**
 * The landing document's census of GitHub's own open list and the selection the reading was taken over, and the
 * readers that hold one against the other. A sibling of `./readLanding.ts`, under every rule its module doc states —
 * the one that matters most being that a malformed field refuses the WHOLE reading rather than being dropped from it.
 */

import { type Bag, bags, bool, num, str, strings, sub } from "../../lib/bag";

/** One open pull request GitHub listed, as much as the page needs to name it. */
export interface LandingCensusPr {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly isDraft: boolean;
  /** Absent for a deleted account. */
  readonly author: string | undefined;
}

/** One repository's census as the verb printed it: GitHub's list and count, or why it could not be read. */
export type LandingRepoCensus =
  | {
      readonly kind: "read";
      readonly repo: string;
      /** When its first page was asked for — no later than anything in it; the page ages the count from here. */
      readonly startedAtIso: string;
      readonly totalCount: number;
      /** The login the token read as — what `--author @me` meant on this read. */
      readonly viewer: string;
      readonly pullRequests: readonly LandingCensusPr[];
    }
  | { readonly kind: "unread"; readonly repo: string; readonly why: string };

/** One census pull request, or `undefined` when a field the page names it by is missing. */
function censusPrOf({ bag }: { bag: Bag }): LandingCensusPr | undefined {
  const number = num({ bag, key: "number" });
  const title = str({ bag, key: "title" });
  const url = str({ bag, key: "url" });
  const isDraft = bool({ bag, key: "isDraft" });
  const author = str({ bag, key: "author" });
  if (number === undefined || title === undefined || url === undefined || isDraft === undefined) {
    return undefined;
  }
  if (bag.author !== undefined && author === undefined) {
    return undefined;
  }
  return { author, isDraft, number, title, url };
}

/** One repository's census, or `undefined` when it is not one the verb wrote. */
function repoCensusOf({ bag }: { bag: Bag }): LandingRepoCensus | undefined {
  const kind = str({ bag, key: "kind" });
  const repo = str({ bag, key: "repo" });
  if (repo === undefined) {
    return undefined;
  }
  if (kind === "unread") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { kind, repo, why };
  }
  const totalCount = num({ bag, key: "totalCount" });
  const viewer = str({ bag, key: "viewer" });
  const startedAtIso = str({ bag, key: "startedAtIso" });
  const held = bags({ bag, key: "pullRequests" });
  if (kind !== "read" || totalCount === undefined || viewer === undefined || held === undefined) {
    return undefined;
  }
  const pullRequests: LandingCensusPr[] = [];
  for (const one of held) {
    const pr = censusPrOf({ bag: one });
    if (pr === undefined) {
      return undefined;
    }
    pullRequests.push(pr);
  }
  // The verb refuses a census whose list and count disagree (`src/live/github/openCensus.ts`); a recorded one
  // that still does is rechecked here, because the page counts `totalCount` and names the list, and the two
  // must add up or the headline claims pull requests it never names.
  const unique = new Set(pullRequests.map((pr) => pr.number)).size;
  if (!Number.isInteger(totalCount) || unique !== pullRequests.length || unique !== totalCount) {
    const why = `the recorded census lists ${String(unique)} distinct pull request(s) in ${String(pullRequests.length)} against a count of ${String(totalCount)}`;
    return { kind: "unread", repo, why };
  }
  // Without its own start the census's age cannot be bounded: the reading's instant is taken after it.
  if (startedAtIso === undefined || Number.isNaN(Date.parse(startedAtIso))) {
    return { kind: "unread", repo, why: "the recorded census carries no instant its first page was asked for" };
  }
  return { kind, pullRequests, repo, startedAtIso, totalCount, viewer };
}

/**
 * The document's census, when present. Absent is an older document and reads as `undefined`; a present one that
 * will not parse refuses the reading, because a census silently missing a pull request is the miscount the page
 * exists to end.
 *
 * @returns the census, `undefined` when the document predates it, or `null` when it is malformed
 */
export function censusOf({ bag }: { bag: Bag }): readonly LandingRepoCensus[] | undefined | null {
  if (bag.census === undefined) {
    return undefined;
  }
  const held = bags({ bag, key: "census" });
  if (held === undefined) {
    return null;
  }
  const byRepo = new Map<string, LandingRepoCensus>();
  for (const one of held) {
    const repo = repoCensusOf({ bag: one });
    if (repo === undefined) {
      return null;
    }
    // Two entries for one repository would be counted twice; neither is believed.
    if (byRepo.has(repo.repo)) {
      byRepo.set(repo.repo, {
        kind: "unread",
        repo: repo.repo,
        why: "the recorded census lists this repository twice",
      });
      continue;
    }
    byRepo.set(repo.repo, repo);
  }
  return [...byRepo.values()];
}

/**
 * The census held against the reading's own selection: a selected repository the census does not carry reads
 * `unread`, and so does a census entry for one the reading was not taken over — so the page both refuses the count
 * and takes a fresh reading, exactly as for a census GitHub would not give.
 *
 * @returns the census with every disagreement with the selection as an `unread` entry
 */
export function censusAgainstSelection({
  census,
  selection,
}: {
  census: readonly LandingRepoCensus[] | undefined;
  selection: LandingSelection | undefined;
}): readonly LandingRepoCensus[] | undefined {
  if (census === undefined) {
    return census;
  }
  if (selection === undefined) {
    return census.map((repo): LandingRepoCensus => ({
      kind: "unread",
      repo: repo.repo,
      why: "the reading records no repository selection, so its census cannot be checked against one",
    }));
  }
  const held = census.map((repo): LandingRepoCensus => {
    if (selection.repos.includes(repo.repo)) {
      return repo;
    }
    return {
      kind: "unread",
      repo: repo.repo,
      why: "the recorded census counts it, but the reading was not taken over it",
    };
  });
  const counted = new Set(census.map((repo) => repo.repo));
  const missing = selection.repos
    .filter((repo) => !counted.has(repo))
    .map((repo): LandingRepoCensus => ({
      kind: "unread",
      repo,
      why: "the reading was taken over it, but the recorded census does not count it",
    }));
  return [...held, ...missing];
}

/** The selection a landing document says it was taken over — the verb's own `selection` field. */
export interface LandingSelection {
  readonly repos: readonly string[];
  readonly author: string | undefined;
  readonly includeDrafts: boolean;
}

/**
 * The document's own `selection`, when present. A present but malformed one refuses the reading, per the
 * rule at the top of this file; an absent one is an older document and reads as `undefined`.
 *
 * @returns the selection, `undefined` when the document predates the field, or `null` when it is malformed
 */
export function selectionOf({ bag }: { bag: Bag }): LandingSelection | undefined | null {
  if (bag.selection === undefined) {
    return undefined;
  }
  const held = sub({ bag, key: "selection" });
  if (held === undefined) {
    return null;
  }
  const repos = strings({ bag: held, key: "repos" });
  const includeDrafts = bool({ bag: held, key: "includeDrafts" });
  if (repos === undefined || includeDrafts === undefined) {
    return null;
  }
  // The verb reads at least one repository and names each by a non-empty slug; a selection saying otherwise
  // is not one this verb wrote, and printing "taken over , author @me" beside a tally is the guess to refuse.
  if (repos.length === 0 || repos.some((slug) => slug.trim() === "")) {
    return null;
  }
  // An ABSENT author is "every author"; a PRESENT one that is not a string is malformed, and reading it as
  // absent would print a confident "every author" over a qualifier the document did not establish (r3).
  const author = str({ bag: held, key: "author" });
  if (held.author !== undefined && (author === undefined || author.trim() === "")) {
    return null;
  }
  return { author, includeDrafts, repos };
}
