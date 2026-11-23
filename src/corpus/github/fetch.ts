/**
 * The impure GitHub edge. Two lanes: REST **search** discovers the PRs/issues touched in a window
 * (poll-by-`updated` so an old item edited inside the window re-surfaces), then the GraphQL **activity**
 * lane enriches each. Network is confined here; discovery + enrichment are injected seams
 * (`SearchIssues`, `FetchGithubActivity`) so the whole orchestration is unit-testable with fakes, and
 * `fetch.ts` is the only module that binds the live request seams; the client they call through is built
 * in `githubClient.ts`.
 *
 * Search is capped at GitHub's hard 1000-result / 10-page ceiling; a caller wanting more must window
 * finer. Per-item enrichment failures are swallowed — the atom still ships without its activity — so one
 * bad item never sinks a refresh. A search failure, by contrast, is fatal (returned as `err`): we never
 * silently persist a partial window.
 */

import type { Repository } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { orThrow } from "../../lib/safeBoundary.js";
import { optStr } from "../slack/shape.js";
import type { ExportWindow } from "../types.js";
import { type FetchGithubActivity, makeFetchGithubActivity } from "./activity.js";
import { enrichFailureWarnings, searchCapWarnings, searchDropWarnings } from "./crawlWarnings.js";
import { type GithubFetchError, GithubFetchErrors } from "./errors.js";
import { type GithubClient, githubScopeId, makeGithubClient } from "./githubClient.js";
import type { GithubExportItem } from "./project.js";

const PER_PAGE = 100;
const MAX_PAGES = 10;
const DEFAULT_PAGE_CAP = 1000;

/** Fetch every in-window item for a repo. `err` only on a hard search failure (never partial). */
export type FetchGithubItems = (input: {
  repo: Repository;
  window: ExportWindow;
}) => Promise<Result<{ items: readonly GithubExportItem[]; warnings: readonly string[] }, GithubFetchError>>;

/** Progress callback fired once per enriched item. */
export type FetchProgress = (progress: { number: number; index: number; total: number }) => void;

/**
 * The durable mid-crawl commit seam: append a BATCH of already-enriched items to bronze before the
 * enrichment loop asks GitHub for the next one.
 *
 * Absent ⇒ the whole window accumulates in memory and the caller writes once at the end, which is a bet
 * that nothing restarts before the crawl finishes. Measured: a killed refresh left no bronze
 * file and no watermark change after fifteen minutes of real provider reads, and a live run was
 * indistinguishable from a dead one from disk.
 *
 * The batch, not the item, is the unit, and the batch is the right one because of where the time goes:
 * discovery is hard-capped at {@link DEFAULT_PAGE_CAP} results and costs at most ten REST pages, while
 * {@link enrichAll} makes one SERIAL GraphQL round trip per item, up to a thousand of them. That loop is
 * what a timeout kills.
 *
 * This is structurally Slack's `commitPartial` rather than its `commit`: rows on disk and NOTHING else —
 * no cursor, no completion marker. Search is `sort: updated, order: desc`, so a partial flush covers the
 * NEWEST items first; a cursor drawn from one would claim the window was covered to the newest instant
 * while the oldest items were still unwritten, which is a lie in the expensive direction.
 *
 * `err` means the batch did not reach disk, so the crawl RETAINS those items for the closing bulk write —
 * a batch whose own commit failed has no other route to bronze.
 */
export type GithubItemsCommit = (batch: {
  readonly items: readonly GithubExportItem[];
  readonly repo: Repository;
}) => Result<{ readonly written: number }>;

/**
 * Enriched items banked per flush before the closing write is offered anything. Measured against nothing —
 * it is a durability/overhead trade, not a tuned number: each flush is one `appendFileSync` against a dedup
 * index the committer already holds open, and 25 items is roughly one enrichment minute on a slow repo.
 */
const ENRICH_FLUSH_ITEMS = 25;

interface SearchArgs {
  readonly q: string;
  readonly sort: "updated";
  readonly order: "desc";
  readonly per_page: number;
  readonly page: number;
}

/** Injected REST search seam. Items are parsed defensively, so the raw shape stays `unknown`. */
export type SearchIssues = (args: SearchArgs) => Promise<{ data: { items: readonly unknown[] } }>;

/** Injected repo-existence precheck: `ok` when the repo is reachable, `err` with a clear message otherwise. */
type CheckRepo = (args: { repo: Repository }) => Promise<Result<void, GithubFetchError>>;

export interface FetchItemsDeps {
  readonly searchIssues: SearchIssues;
  /** Optional precheck run BEFORE search — turns a bad org/repo slug into one clear line, not a raw 404. */
  readonly checkRepo?: CheckRepo;
  /** Absent ⇒ discovery only, no enrichment (atoms carry no reviews/comments/state). */
  readonly fetchActivity?: FetchGithubActivity;
  readonly pageCap?: number;
  readonly onProgress?: FetchProgress;
  /**
   * The durable mid-crawl commit seam ({@link GithubItemsCommit}). It rides the ENRICHMENT loop only: a
   * discovery-only crawl is at most ten REST pages and has no long pole to be killed in the middle of.
   */
  readonly onBatch?: GithubItemsCommit;
}

/** Defensively shape one raw search hit into an item; `undefined` when it lacks a usable number. */
function toExportItem({ raw }: { raw: unknown }): GithubExportItem | undefined {
  if (!isRecord(raw) || typeof raw["number"] !== "number") {
    return undefined;
  }
  const title = optStr({ value: raw["title"] });
  const url = optStr({ value: raw["html_url"] });
  const tsIso = optStr({ value: raw["updated_at"] }) ?? optStr({ value: raw["created_at"] });
  // A hit missing any core field is unusable — no title to read, no url to cite, no timestamp to window. Drop it.
  if (title === undefined || url === undefined || tsIso === undefined) {
    return undefined;
  }
  const isPr = isRecord(raw["pull_request"]);
  const author = isRecord(raw["user"]) ? optStr({ value: raw["user"]["login"] }) : undefined;
  const body = optStr({ value: raw["body"] });
  return {
    kind: isPr ? "pr" : "issue",
    number: raw["number"],
    title,
    tsIso,
    url,
    ...(author !== undefined ? { author } : {}),
    ...(body !== undefined ? { body } : {}),
    raw,
  };
}

/**
 * Split one page of raw search hits into usable export items + a count of hits dropped for missing a core
 * field (number/title/url/timestamp). Pure.
 *
 * @param hits the raw search hits for one page
 * @returns the parsed items and how many were dropped
 */
export function collectSearchHits({ hits }: { hits: readonly unknown[] }): {
  readonly items: readonly GithubExportItem[];
  readonly dropped: number;
} {
  const items: GithubExportItem[] = [];
  let dropped = 0;
  for (const raw of hits) {
    const item = toExportItem({ raw });
    if (item === undefined) {
      dropped += 1; // a hit missing a core field — unusable; surfaced below, never silent.
    } else {
      items.push(item);
    }
  }
  return { dropped, items };
}

/** Page through search until a short page or the cap. A thrown search error is fatal → `err`. */
async function searchAll({
  searchIssues,
  q,
  pageCap,
}: {
  searchIssues: SearchIssues;
  q: string;
  pageCap: number;
}): Promise<Result<{ items: GithubExportItem[]; warnings: readonly string[] }, GithubFetchError>> {
  const items: GithubExportItem[] = [];
  let dropped = 0;
  // Pessimistic: only a page SHORTER than `per_page` proves the window was exhausted, so that is the one
  // thing that clears this. Running out of pages at `MAX_PAGES` is the ceiling just as much as reaching
  // `pageCap` is, and starting from `false` would report that case as a complete window.
  let truncated = true;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let hits: readonly unknown[];
    try {
      const res = await searchIssues({ order: "desc", page, per_page: PER_PAGE, q, sort: "updated" });
      hits = res.data.items;
    } catch (error: unknown) {
      return err(GithubFetchErrors.searchFailed({ cause: error }));
    }
    const page1 = collectSearchHits({ hits });
    items.push(...page1.items);
    dropped += page1.dropped;
    if (hits.length < PER_PAGE) {
      truncated = false; // a short page is GitHub saying there is no more — the only proof of completeness
      break;
    }
    if (items.length >= pageCap) {
      break; // a FULL last page plus a stop means the ceiling ended this, not the data
    }
  }
  // Never drop silently: report the count so a shrunken window is visible (the caller relays warnings).
  return ok({
    items: items.slice(0, pageCap),
    warnings: [...searchDropWarnings({ dropped }), ...searchCapWarnings({ cap: pageCap, truncated })],
  });
}

/**
 * Bank one batch of enriched items durably, or report that the crawl must keep holding them.
 *
 * Two outcomes hand the batch back and they are NOT the same case: no seam at all means this run is on the
 * write-once path deliberately (see {@link ../../cli/commands/refresh/githubJobs.githubItemsCommitter} for
 * why a bounded run must stay there), while a FAILED commit means durability was attempted and missed,
 * which the run has to say out loud rather than swallow.
 *
 * @param onBatch the commit seam, absent on a write-once run
 * @param batch the enriched items to bank
 * @param repo the repository they came from
 * @param warnings the crawl's running warning list, MUTATED in place on a failed commit
 * @returns true when the batch reached bronze, so the caller must NOT also retain it
 */
function bankGithubBatch({
  onBatch,
  batch,
  repo,
  warnings,
}: {
  onBatch: GithubItemsCommit | undefined;
  batch: readonly GithubExportItem[];
  repo: Repository;
  warnings: string[];
}): boolean {
  if (onBatch === undefined || batch.length === 0) {
    return false;
  }
  const banked = onBatch({ items: batch, repo });
  if (banked.isErr()) {
    warnings.push(...banked.error.map((line) => `github batch commit failed: ${line}`));
    return false;
  }
  return true;
}

/**
 * Enrich each item; a per-item failure ships the item without activity (never fatal) but is counted.
 *
 * With a commit seam the enriched items are flushed every {@link ENRICH_FLUSH_ITEMS} and the flushed ones
 * are NOT returned — so the caller's closing write is offered only what no flush covered, and the run's
 * `projected`/`deduped` counts stay true (`corpus/ingestSource.runCounts` sums the two halves).
 */
async function enrichAll({
  items,
  repo,
  fetchActivity,
  onProgress,
  onBatch,
}: {
  items: readonly GithubExportItem[];
  repo: Repository;
  fetchActivity: FetchGithubActivity;
  onProgress?: FetchProgress;
  onBatch?: GithubItemsCommit;
}): Promise<{ items: GithubExportItem[]; warnings: readonly string[] }> {
  const retained: GithubExportItem[] = [];
  let pending: GithubExportItem[] = [];
  const warnings: string[] = [];
  // Collected rather than folded into a running "first": the warning quotes ONE cause because every item
  // fails identically when the query itself is wrong, and a list makes that the reader's choice, not a
  // conditional assignment two gates disagree about how to spell.
  const failures: string[] = [];
  const flush = (): void => {
    if (!bankGithubBatch({ batch: pending, onBatch, repo, warnings })) {
      retained.push(...pending);
    }
    pending = [];
  };
  for (const [index, item] of items.entries()) {
    const result = await fetchActivity({ isPr: item.kind === "pr", number: item.number, repo });
    if (result.isErr()) {
      failures.push(result.error.message);
    }
    pending.push(result.isOk() ? { ...item, activity: result.value } : item);
    if (pending.length >= ENRICH_FLUSH_ITEMS) {
      flush();
    }
    onProgress?.({ index: index + 1, number: item.number, total: items.length });
  }
  flush();
  return {
    items: retained,
    warnings: [
      ...warnings,
      ...enrichFailureWarnings({ failed: failures.length, firstError: failures[0], total: items.length }),
    ],
  };
}

/**
 * Build a `FetchGithubItems` over injected seams. This is what tests use.
 *
 * @param deps the search seam, optional enrichment seam, page cap, and progress callback
 * @returns a repo+window fetcher
 */
export function makeGithubFetchItems(deps: FetchItemsDeps): FetchGithubItems {
  const { pageCap = DEFAULT_PAGE_CAP } = deps;
  return async ({ repo, window }) => {
    // Precheck the repo first: a typo'd org/repo slug becomes one actionable line instead of a raw search 404.
    if (deps.checkRepo !== undefined) {
      const reachable = await deps.checkRepo({ repo });
      if (reachable.isErr()) {
        return err(reachable.error);
      }
    }
    const q = `repo:${repo.owner}/${repo.repo} updated:${window.since}..${window.until}`;
    const searched = await searchAll({ pageCap, q, searchIssues: deps.searchIssues });
    if (searched.isErr()) {
      return searched;
    }
    if (deps.fetchActivity === undefined) {
      return ok({ items: searched.value.items, warnings: searched.value.warnings });
    }
    const enriched = await enrichAll({
      fetchActivity: deps.fetchActivity,
      items: searched.value.items,
      repo,
      ...(deps.onBatch !== undefined ? { onBatch: deps.onBatch } : {}),
      ...(deps.onProgress !== undefined ? { onProgress: deps.onProgress } : {}),
    });
    return ok({
      items: enriched.items,
      warnings: [...searched.value.warnings, ...enriched.warnings],
    });
  };
}

/**
 * The three live Octokit seams.
 *
 * These were the LAST raw boundaries in the program with no `safe*` wrapper at all — the boundary-residue
 * gate could not see them, because its token list did not cover Octokit until PR5.2.1b added
 * `client.rest`/`client.graphql`. Each is `retryMode: "never"`: the client is an
 * `Octokit.plugin(retry, throttling)`, which already owns GitHub's retry, and a second budget on top of it
 * would stack multiplicatively. `orThrow` re-surfaces the original error object unchanged, so `checkRepo`'s
 * status-inspecting policy and `searchAll`'s catch-to-`err` both run exactly as before.
 */
function githubSearchSeam({ client, scopeId }: { client: GithubClient; scopeId: string }): SearchIssues {
  return async (args) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          client.rest.search.issuesAndPullRequests({
            order: args.order,
            page: args.page,
            per_page: args.per_page,
            q: args.q,
            sort: args.sort,
          }),
        operation: "github.search.issuesAndPullRequests",
        provider: "github",
        retryMode: "never",
        scopeId,
      }),
    });
    return { data: { items: res.data.items } };
  };
}

/** The repo-existence precheck seam. A 404/422/403 becomes one actionable line, never a raw throw. */
function githubCheckRepoSeam({ client, scopeId }: { client: GithubClient; scopeId: string }): CheckRepo {
  return async ({ repo }) => {
    try {
      orThrow({
        result: await safeProviderCall({
          execute: () => client.rest.repos.get({ owner: repo.owner, repo: repo.repo }),
          operation: "github.repos.get",
          provider: "github",
          retryMode: "never",
          scopeId,
        }),
      });
      return ok(undefined);
    } catch (error: unknown) {
      const status = isRecord(error) && typeof error["status"] === "number" ? error["status"] : undefined;
      if (status === 404 || status === 422 || status === 403) {
        return err(GithubFetchErrors.repoNotFound({ owner: repo.owner, repo: repo.repo }));
      }
      return err(GithubFetchErrors.repoPrecheckFailed({ cause: error, owner: repo.owner, repo: repo.repo }));
    }
  };
}

/** The GraphQL enrichment seam. */
function githubActivitySeam({ client, scopeId }: { client: GithubClient; scopeId: string }): FetchGithubActivity {
  return makeFetchGithubActivity({
    graphql: async (query, variables) =>
      orThrow({
        result: await safeProviderCall({
          execute: () => client.graphql(query, variables),
          operation: "github.graphql.activity",
          provider: "github",
          retryMode: "never",
          scopeId,
        }),
      }),
  });
}

/**
 * The production GitHub item fetcher, bound to a token.
 *
 * @param token the token to use; omit to fall back to the `gh` CLI login
 * @param enrich whether to make the extra per-item calls that fill in detail — off makes a cheaper, thinner crawl
 * @param onProgress the per-item progress hook, omitted when nothing is watching
 * @param onBatch the durable mid-crawl commit seam, omitted on a write-once run
 * @returns the bound fetcher
 */
export function githubFetchItems({
  token,
  enrich = true,
  onProgress,
  onBatch,
}: {
  token?: string;
  enrich?: boolean;
  onProgress?: FetchProgress;
  onBatch?: GithubItemsCommit;
}): FetchGithubItems {
  const client = makeGithubClient({ token });
  const scopeId = githubScopeId({ token });
  const fetchActivity = enrich ? githubActivitySeam({ client, scopeId }) : undefined;
  return makeGithubFetchItems({
    checkRepo: githubCheckRepoSeam({ client, scopeId }),
    searchIssues: githubSearchSeam({ client, scopeId }),
    ...(fetchActivity !== undefined ? { fetchActivity } : {}),
    ...(onBatch !== undefined ? { onBatch } : {}),
    ...(onProgress !== undefined ? { onProgress } : {}),
  });
}
