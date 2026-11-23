/**
 * The pull-request surface's reconciliation against GitHub's own open list — what proves a hole in the landing
 * read's rows, and what proves a row ended — split from `./nothingStalePullRequests.ts`, which places each row.
 *
 * ## An open pull request the rows did not place is a hole, never an absence
 *
 * The read carries GitHub's own open list per selected repository beside its rows (`census`,
 * `../live/github/openCensus.ts`). One of the owner's — matching the read's `selection`, drafts only when it asked for
 * them — that no row or press carries is named unseen, and so is a selected repository whose list is unread or
 * missing: otherwise a pull request the read dropped would vanish and the section could still read all-clear.
 * MEASURED: 75 of the owner's open across both repositories, 75 rows, none unplaced —
 * `jq -c '([.rows[], .presses[]] | map("\(.repoSlug)#\(.number)")) as $p | [.census[] | .viewer as $v | .repo as $r | [.pullRequests[]? | select((.author // "" | ascii_downcase) == ($v | ascii_downcase)) | "\($r)#\(.number)" | select(. as $id | $p | index($id) == null)]]' github-landing.json`
 * printed `[[],[]]`.
 *
 * The same list ends a row: one whose repository has a read list that does not carry its number closed or merged
 * by then, so it is a caveat line and never an item — the reading `landingClosure.ts` settles board rows on.
 * Every list for a repository counts, so a second entry for one can neither hide a pull request nor end one the first carries, and a repository is matched case-insensitively, as GitHub names one
 * and `landingClosure.ts` reads one.
 *
 * Pure.
 */
import type { LandingBriefingDocument } from "./nothingStaleTypes.js";

/**
 * A pull request's identity for comparison only: GitHub names a repository case-insensitively.
 *
 * @param repoSlug `owner/name`, in whatever case the source spelled it
 * @returns the identity with the repository lower-cased
 */
export function matchKey({ repoSlug, number }: { readonly repoSlug: string; readonly number: number }): string {
  return `pull-request:${repoSlug.toLowerCase()}#${String(number)}`;
}

/** Whether two repository names are one repository, as GitHub compares them. */
function sameRepo({ a, b }: { readonly a: string; readonly b: string }): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The login the read's selection means in one repository's list: `@me` is the viewer that list was read as, a
 * login is itself, and no qualifier is every author. `@me` matches in any case, as `landingCore.ts` reads it.
 *
 * @param author the selection's `--author` as typed
 * @param viewer the login that repository's list was read as
 * @returns the lower-cased login, or `undefined` for every author
 */
function selectedLogin({
  author,
  viewer,
}: {
  readonly author: string | undefined;
  readonly viewer: string;
}): string | undefined {
  if (author === undefined) {
    return undefined;
  }
  if (author.toLowerCase() === "@me") {
    return viewer.toLowerCase();
  }
  return author.toLowerCase();
}

/**
 * Every hole GitHub's own open list proves in the rows: a selected repository whose list is missing or
 * unread, and each open pull request the selection matches that no row or press carries.
 *
 * @param document the validated landing read
 * @returns one sentence per hole, empty when the rows place every one
 */
export function censusHoles({ document }: { readonly document: LandingBriefingDocument }): readonly string[] {
  const pressed = document.presses.filter((press) => press.outcome === "pressed");
  const placed = new Set([...document.rows, ...pressed].map((entry) => matchKey(entry)));
  const { selection } = document;
  const repos = selection.repos.filter(
    (repo, index) => selection.repos.findIndex((other) => sameRepo({ a: other, b: repo })) === index,
  );
  return repos.flatMap((repo) => {
    const lists = document.census.filter((census) => sameRepo({ a: census.repo, b: repo }));
    if (lists.length === 0) {
      return [`GitHub's open list for ${repo} is not in the landing read, so a pull request it dropped is unseen`];
    }
    const holes = lists.flatMap((list) => {
      if (list.kind === "unread") {
        return [`GitHub's open list for ${repo} could not be read: ${list.why}`];
      }
      const login = selectedLogin({ author: selection.author, viewer: list.viewer });
      return list.pullRequests
        .filter((pr) => login === undefined || pr.author?.toLowerCase() === login)
        .filter((pr) => selection.includeDrafts || !pr.isDraft)
        .filter((pr) => !placed.has(matchKey({ number: pr.number, repoSlug: repo })))
        .map((pr) => `${repo}#${String(pr.number)} is open on GitHub and the landing read did not place it`);
    });
    return [...new Set(holes)];
  });
}

/**
 * The caveat a read that left drafts out carries: how many open drafts of the owner's its read lists show, so the
 * number it does not count is on the page rather than implied.
 *
 * @param document the validated landing read, whose selection left drafts out
 * @returns one caveat line
 */
export function draftsBound({ document }: { readonly document: LandingBriefingDocument }): string {
  const drafts = new Set(
    document.census.flatMap((list) => {
      if (list.kind === "unread") {
        return [];
      }
      const login = selectedLogin({ author: document.selection.author, viewer: list.viewer });
      return list.pullRequests
        .filter((pr) => pr.isDraft && (login === undefined || pr.author?.toLowerCase() === login))
        .map((pr) => matchKey({ number: pr.number, repoSlug: list.repo }));
    }),
  );
  return `the landing read left drafts out, so ${String(drafts.size)} open draft(s) of yours that GitHub listed are not counted here`;
}

/**
 * The pull requests the read's own open lists prove ended: a repository with at least one READ list, and a
 * number none of its read lists carries. A repository with no read list proves nothing, so nothing in it ends.
 * Only rows and PRESSED presses are entries: a press that failed or only would have happened places nothing,
 * so it can neither be counted nor be named as ended.
 *
 * @param document the validated landing read
 * @returns the {@link matchKey} identities GitHub no longer listed as open
 */
export function endedIdentities({ document }: { readonly document: LandingBriefingDocument }): ReadonlySet<string> {
  const listed = new Map<string, Set<number>>();
  for (const list of document.census) {
    if (list.kind === "read") {
      const repo = list.repo.toLowerCase();
      const before = listed.get(repo);
      const numbers = list.pullRequests.map((pr) => pr.number);
      listed.set(repo, new Set(before === undefined ? numbers : [...before, ...numbers]));
    }
  }
  const pressed = document.presses.filter((press) => press.outcome === "pressed");
  const ended = [...document.rows, ...pressed].filter((entry) => {
    const numbers = listed.get(entry.repoSlug.toLowerCase());
    return numbers !== undefined && !numbers.has(entry.number);
  });
  return new Set(ended.map((entry) => matchKey(entry)));
}
