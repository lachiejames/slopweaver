/**
 * A live GitHub search — the discovery half of the named-object door. `../providerRead.ts` answers "what
 * does this exact object say"; this answers "does something matching this term already exist", which needs
 * no address, only a term and a repo to search within.
 *
 * Deliberately thin: the term is handed to GitHub's own search syntax almost unchanged (only a `repo:`
 * qualifier is added), so a caller who already knows GitHub's query grammar (`is:pr`, `label:bug`, …) can
 * use it here too. This is a wrapper over a real search API, not a smarter-than-the-platform matcher.
 */

import type { Repository } from "../../config.js";
import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";

/** One GitHub search result, trimmed to what a caller needs to identify and link to it — not the full object. */
export interface GithubSearchMatch {
  readonly kind: "issue" | "pull-request";
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly identity: string;
}

/**
 * What the search read and did not establish. `kind` is the discriminator a caller branches on: `complete`
 * means every match GitHub counted came back on this page, so the matches ARE the set; `bounded` means the
 * page held fewer than `totalCount` (or dropped a hit), so the matches are a sample of the set, in GitHub's
 * best-match order — measured newest-first for a term-less query (`is:pr is:open`, three reads
 * 80 minutes apart, all strictly descending by number), so a bounded page omits the OLDEST matches: for open
 * pull requests, exactly the ones closest to landing. A bounded page is UNKNOWN to anything that needs a set.
 */
export interface GithubSearchCoverage {
  readonly kind: "complete" | "bounded";
  readonly detail: string;
  readonly residue: readonly string[];
}

/** A search result set: the query GitHub actually ran, what it found, and how much was withheld. */
export interface GithubSearchDocument {
  readonly source: "github";
  readonly term: string;
  readonly repo: string;
  readonly searchedAtIso: string;
  readonly totalCount: number;
  readonly matches: readonly GithubSearchMatch[];
  readonly coverage: GithubSearchCoverage;
}

/** One page of GitHub's `/search/issues` response, defensively typed (the raw shape stays `unknown`). */
interface GithubSearchPage {
  readonly total_count: number;
  /** GitHub's own flag that the search timed out and `items` holds only what it found before then. */
  readonly incomplete_results: boolean;
  readonly items: readonly unknown[];
}

/** The injected REST search seam. Production wraps Octokit in `safeProviderCall`; tests supply a plain fake. */
export type GithubSearchIssues = (args: {
  q: string;
  per_page: number;
}) => Promise<Result<GithubSearchPage, GithubLiveError>>;

/**
 * Build the exact query GitHub's search API runs: the caller's term, scoped to one repository.
 *
 * @param term the caller's search term, already known non-blank
 * @param repo the repository to scope the search to
 * @returns the GitHub search query string
 */
export function buildGithubSearchQuery({ term, repo }: { term: string; repo: Repository }): string {
  return `${term} repo:${repo.owner}/${repo.repo}`;
}

/** Defensively shape one raw search hit into a match; `undefined` when it lacks a usable core field. */
function toSearchMatch({ raw, repo }: { raw: unknown; repo: Repository }): GithubSearchMatch | undefined {
  if (!isRecord(raw) || typeof raw["number"] !== "number") {
    return undefined;
  }
  const title = optStr({ value: raw["title"] });
  const url = optStr({ value: raw["html_url"] });
  const state = optStr({ value: raw["state"] });
  const updatedAt = optStr({ value: raw["updated_at"] });
  if (title === undefined || url === undefined || state === undefined || updatedAt === undefined) {
    return undefined;
  }
  return {
    identity: `${repo.owner}/${repo.repo}#${String(raw["number"])}`,
    kind: isRecord(raw["pull_request"]) ? "pull-request" : "issue",
    number: raw["number"],
    state,
    title,
    updatedAt,
    url,
  };
}

/**
 * Shape every raw search hit, dropping any missing a core field rather than failing the whole search.
 *
 * @param hits the raw search hits GitHub returned
 * @param repo the repository the search was scoped to
 * @returns the usable matches and how many hits were dropped
 */
export function collectSearchMatches({ hits, repo }: { hits: readonly unknown[]; repo: Repository }): {
  readonly matches: readonly GithubSearchMatch[];
  readonly dropped: number;
} {
  const matches: GithubSearchMatch[] = [];
  let dropped = 0;
  for (const raw of hits) {
    const match = toSearchMatch({ raw, repo });
    if (match === undefined) {
      dropped += 1;
    } else {
      matches.push(match);
    }
  }
  return { dropped, matches };
}

/**
 * Judge whether one page held the whole result set.
 *
 * GitHub reports `total_count` across every page while returning at most `per_page` hits, ordered by relevance,
 * so a page is complete only when it carried every counted hit AND every hit shaped into a match. A dropped hit
 * makes the page bounded too: the set GitHub counted is not the set the caller holds. So does a search GitHub
 * itself marks `incomplete_results` — it timed out, and `total_count` then counts only what it found.
 *
 * @param limit the page size requested
 * @param totalCount what GitHub counted across every page
 * @param held how many hits the page returned
 * @param dropped how many of those hits lacked a core field
 * @param incomplete GitHub's `incomplete_results`: the search timed out before it saw every match
 * @returns the coverage a caller branches on
 */
export function judgeSearchCoverage({
  limit,
  totalCount,
  held,
  dropped,
  incomplete,
}: {
  limit: number;
  totalCount: number;
  held: number;
  dropped: number;
  incomplete: boolean;
}): GithubSearchCoverage {
  const residue = [
    "only GitHub's own best-match relevance ranking was used; no fuzzy or model-based matching",
    ...(dropped > 0 ? [`skipped ${String(dropped)} search hit(s) missing a core field`] : []),
  ];
  if (incomplete) {
    return {
      detail: `GitHub marked the search incomplete_results (it timed out), so its ${String(totalCount)} match(es) are a SAMPLE, not the set`,
      kind: "bounded",
      residue,
    };
  }
  if (held >= totalCount && dropped === 0) {
    return {
      detail: `all ${String(totalCount)} match(es) on one page (--limit ${String(limit)})`,
      kind: "complete",
      residue,
    };
  }
  const withheld = Math.max(totalCount - held, 0);
  return {
    detail:
      `${String(held - dropped)} of ${String(totalCount)} match(es) — ${String(withheld)} withheld by the page bound ` +
      `(--limit ${String(limit)}); GitHub's best-match order decides which (measured newest-first for a term-less ` +
      `query, so the OLDEST are the ones missing), so this is a SAMPLE, not the set`,
    kind: "bounded",
    residue,
  };
}

/**
 * Search one repository for a matching issue or pull request.
 *
 * A GitHub search returning zero hits is not a failure — it is answered with an empty `matches` array, the
 * same as any other count, so a caller checking "does this already exist" reads `matches.length === 0` as a
 * normal outcome rather than catching an error.
 *
 * @param term the caller's search term; refused when blank
 * @param repo the repository to scope the search to
 * @param limit the maximum number of results to request
 * @param search the injected, safe-wrapped REST seam
 * @param nowIso the freshness clock
 * @returns the search document, or a named search failure
 */
export async function searchGithubObjects({
  term,
  repo,
  limit,
  search,
  nowIso,
}: {
  term: string;
  repo: Repository;
  limit: number;
  search: GithubSearchIssues;
  nowIso: () => string;
}): Promise<Result<GithubSearchDocument, GithubLiveError>> {
  const trimmed = term.trim();
  if (trimmed.length === 0) {
    return err(GithubLiveErrors.invalidTerm({ message: "a search term is required" }));
  }
  const response = await search({ per_page: limit, q: buildGithubSearchQuery({ repo, term: trimmed }) });
  if (response.isErr()) {
    return err(response.error);
  }
  const { dropped, matches } = collectSearchMatches({ hits: response.value.items, repo });
  return ok({
    coverage: judgeSearchCoverage({
      dropped,
      held: response.value.items.length,
      incomplete: response.value.incomplete_results,
      limit,
      totalCount: response.value.total_count,
    }),
    matches,
    repo: `${repo.owner}/${repo.repo}`,
    searchedAtIso: nowIso(),
    source: "github",
    term: trimmed,
    totalCount: response.value.total_count,
  });
}

/**
 * Render a search document as stable, pretty JSON.
 *
 * @param document the search document
 * @returns one JSON document, with a trailing newline supplied by the logger rather than embedded here
 */
export function renderGithubSearchJson({ document }: { document: GithubSearchDocument }): string {
  return JSON.stringify(document, undefined, 2);
}

/**
 * Render a compact human summary: one line per match, or an explicit "no match" line.
 *
 * @param document the search document
 * @returns human-readable text
 */
export function renderGithubSearchText({ document }: { document: GithubSearchDocument }): string {
  const header = [
    `github search "${document.term}" in ${document.repo}`,
    `searched at: ${document.searchedAtIso}`,
    `coverage: ${document.coverage.kind} — ${document.coverage.detail}`,
    `residue: ${document.coverage.residue.join("; ")}`,
    "",
  ];
  if (document.matches.length === 0) {
    return [...header, "no match found"].join("\n");
  }
  const lines = document.matches.map(
    (match) => `[${match.kind} ${match.state}] ${match.identity} — ${match.title} (${match.url})`,
  );
  return [...header, ...lines].join("\n");
}
