/**
 * GitHub fetch orchestration for `slopweaver refresh` — the two shapes a GitHub ingest can take.
 *
 * Single-repo mode (`githubJob`) resolves ONE repository and runs the discovery+enrichment pipeline over it,
 * plus the additive curated lane. Org mode (`githubOrgJob`, behind `--all-repos`) enumerates the org's repos
 * and fans that same per-repo pipeline over them, concurrency-capped and rate-paced, resuming each repo from
 * its own per-repo watermark — the SECOND cursor store beside the per-source one.
 *
 * Extracted from the `refresh` shell so the shell composes source jobs rather than knowing how GitHub is
 * crawled. Both builders are effectful factories: they read tokens and resolve the repository eagerly (so a
 * bad slug is an error before any network call) and return a `SourceIngestJob` whose `run` does the fetching.
 */

import { githubToken, parseRepositorySlug, type Repository, resolveRepository } from "../../../config.js";
import { projectGithubCurated } from "../../../corpus/github/curated.js";
import { fetchGithubCurated, makeGithubCuratedApi } from "../../../corpus/github/curatedFetch.js";
import { type FetchProgress, githubFetchItems } from "../../../corpus/github/fetch.js";
import { enumerateOrgRepos } from "../../../corpus/github/org.js";
import { fetchOrgActivity, type OrgRepoProgress } from "../../../corpus/github/orgActivity.js";
import { DEFAULT_GITHUB_PAGE_CAP, makeGithubOrgApi } from "../../../corpus/github/orgApi.js";
import { projectGithubRecords } from "../../../corpus/github/project.js";
import { advanceGithubRepoWatermarks, readGithubRepoWatermarks } from "../../../corpus/github/repoWatermark.js";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import type { CorpusRecord, ExportWindow } from "../../../corpus/types.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { RefreshOptions } from "./core.js";
import { githubDurabilityNotes, githubRunCommitter, repoKeyOf } from "./githubCommitter.js";

/**
 * The GitHub credential read both builders take, keyed by the run's own state home. `githubToken` is the
 * production shape; it is a seam rather than a direct import because its `gh auth token` tier shells out,
 * which no unit test can call deterministically.
 */
export type GithubTokenResolver = (args: { home: string }) => string | undefined;

/** GitHub org-mode fan-out: at most this many repos fetched at once (the concurrency ceiling). */
const ORG_CONCURRENCY = 3;
/** GitHub org-mode fan-out: repo fetches STARTED per second (octokit's own throttle paces the inner calls). */
const ORG_RATE_PER_SEC = 1;

/**
 * Build the GitHub ingest job (unchanged discovery+enrichment behaviour, wrapped as a source job).
 *
 * @param repoSlug the explicit `owner/repo`, or undefined to resolve the current checkout's remote
 * @param window the export window to fetch
 * @param noEnrich whether `--no-enrich` suppressed the reviews/comments pass
 * @param onProgress the optional per-item progress hook
 * @param home the Slopweaver home the durable commits append into
 * @param bounded whether `--sample`/`--fetch-cap` bounded the run, which withholds the durable committer
 * @param cursorIsolated whether this run must leave the file corpus untouched, which withholds it too
 * @param resolveToken the credential read, always asked for THIS run's `home` — a `--home B` run must
 *   resolve its GitHub token from B's secrets, never the ambient home's; a test injects a plain fake here
 *   because the production read shells out to `gh`
 * @returns the source job, or the repo-resolution error
 */
export function githubJob({
  repoSlug,
  window,
  noEnrich,
  onProgress,
  home,
  bounded = false,
  cursorIsolated = false,
  resolveToken = githubToken,
}: {
  repoSlug: string | undefined;
  window: ExportWindow;
  noEnrich: boolean;
  onProgress?: FetchProgress;
  home: string;
  bounded?: boolean;
  cursorIsolated?: boolean;
  resolveToken?: GithubTokenResolver;
}): Result<SourceIngestJob> {
  const repoResult = repoSlug !== undefined ? parseRepositorySlug({ slug: repoSlug }) : resolveRepository();
  if (repoResult.isErr()) {
    return err(repoResult.error);
  }
  const repo = repoResult.value;
  const token = resolveToken({ home });
  const enrich = !noEnrich && token !== undefined;
  if (token === undefined) {
    logger.warn({
      msg: "no GitHub auth (set GITHUB_TOKEN or run `gh auth login`) — discovery-only, no reviews/comments",
    });
  }
  return ok({
    label: `${repo.owner}/${repo.repo}`,
    run: () =>
      runGithubRepoActivity({
        bounded,
        cursorIsolated,
        enrich,
        home,
        repo,
        window,
        ...tokenArg({ token }),
        ...progressArg({ onProgress }),
      }),
    source: "github",
    window,
  });
}

/** The token argument, absent rather than `undefined` under `exactOptionalPropertyTypes`. */
function tokenArg({ token }: { token: string | undefined }): { token?: string } {
  return token === undefined ? {} : { token };
}

/** The per-item progress argument, absent rather than `undefined`. */
function progressArg({ onProgress }: { onProgress: FetchProgress | undefined }): { onProgress?: FetchProgress } {
  return onProgress === undefined ? {} : { onProgress };
}

/**
 * Run the single-repo pipeline, flushing enriched items to bronze as they land.
 *
 * The enrichment loop is the long pole — one serial GraphQL round trip per discovered item — so it commits
 * every {@link ../../../corpus/github/fetch.ENRICH_FLUSH_ITEMS} items and the closing write is offered only
 * what no flush covered. The CURATED lane stays on the closing write: it is a small additive fetch made
 * after the crawl, so no flush can have covered it.
 *
 * @param repo the resolved repository
 * @param window the export window
 * @param enrich whether the reviews/comments pass runs at all
 * @param token the GitHub token, when one resolved
 * @param home the Slopweaver home
 * @param bounded whether the run is capped, which withholds the durable committer
 * @param cursorIsolated whether the run must leave the file corpus untouched
 * @param onProgress the optional per-item progress hook
 * @returns the records the closing write still has to carry, plus the run's counts and notes
 */
async function runGithubRepoActivity({
  repo,
  window,
  enrich,
  token,
  home,
  bounded,
  cursorIsolated,
  onProgress,
}: {
  repo: Repository;
  window: ExportWindow;
  enrich: boolean;
  token?: string;
  home: string;
  bounded: boolean;
  cursorIsolated: boolean;
  onProgress?: FetchProgress;
}): Promise<
  Result<{
    records: readonly CorpusRecord[];
    warnings: readonly string[];
    notes: readonly string[];
    committedPerContainer: number;
    projectedPerContainer: number;
    committedCursor?: string;
  }>
> {
  const committer = githubRunCommitter({ bounded, cursorIsolated, home, window });
  const fetched = await githubFetchItems({
    enrich,
    ...tokenArg({ token }),
    ...progressArg({ onProgress }),
    ...(committer !== undefined ? { onBatch: committer.commitBatch } : {}),
  })({ repo, window });
  if (fetched.isErr()) {
    return err([fetched.error.message]);
  }
  const container = repoKeyOf({ repo });
  // Only what NO flush covered — re-offering a banked item would double it in `projected` and count it
  // again as a dedup (`corpus/ingestSource.runCounts`).
  const activity = projectGithubRecords({ items: fetched.value.items, repo: container });
  // The curated lane (discussions/releases/milestones/CODEOWNERS) is additive + best-effort — a disabled
  // surface warns, never fails. It needs auth, so it only runs when a token is present.
  const curated =
    token !== undefined
      ? await fetchGithubCurated({ api: makeGithubCuratedApi({ token }), repo })
      : { items: undefined, warnings: [] };
  const curatedRecords =
    curated.items !== undefined ? projectGithubCurated({ items: curated.items, repo: container }) : [];
  const tally = committer?.tally();
  return ok({
    committedPerContainer: tally === undefined ? 0 : tally.written,
    notes: githubDurabilityNotes({ tally }),
    projectedPerContainer: tally === undefined ? 0 : tally.projected,
    records: [...activity, ...curatedRecords],
    warnings: [...fetched.value.warnings, ...curated.warnings],
    ...(tally?.committedCursor !== undefined ? { committedCursor: tally.committedCursor } : {}),
  });
}

/**
 * The page ceiling every GitHub org list walks under — `--github-page-cap` when given, else
 * {@link DEFAULT_GITHUB_PAGE_CAP}. One reader for both org-mode lanes (activity fan-out and structural
 * hydration), so a run cannot enumerate repos under one ceiling and teams under another. Pure.
 *
 * @param options the parsed refresh options
 * @returns the ceiling to page under
 */
export function githubPageCapOf({ options }: { options: RefreshOptions }): number {
  const { githubPageCap = DEFAULT_GITHUB_PAGE_CAP } = options;
  return githubPageCap;
}

/**
 * Resolve the org to enumerate in org mode: `--github-org`, else `--repo` owner, else the current remote.
 *
 * @param options the parsed refresh options
 * @returns the org login, or the repo-resolution error
 */
export function resolveGithubOrg({ options }: { options: RefreshOptions }): Result<string> {
  if (options.githubOrg !== undefined) {
    return ok(options.githubOrg);
  }
  const repoResult = options.repo !== undefined ? parseRepositorySlug({ slug: options.repo }) : resolveRepository();
  return repoResult.isOk() ? ok(repoResult.value.owner) : err(repoResult.error);
}

/**
 * Build the GitHub ORG-MODE ingest job (`--all-repos`): enumerate + select the org's repos, fan the existing
 * per-repo pipeline over them (concurrency-capped + rate-paced), and resume each from its own per-repo
 * watermark. A repo-enumeration failure fails the job; one repo's fetch failure is a warning, never fatal.
 *
 * @param options the parsed refresh options
 * @param window the export window to fetch
 * @param home the Slopweaver home, which holds the per-repo cursor store
 * @param onRepoProgress the optional per-repo progress hook
 * @param ignoreRepoCursors true when an explicit `--since`/`--all`/`--lookback-days` must beat the PER-REPO
 *   cursors too
 * @param resolveToken the credential read, asked for THIS run's `home` — see {@link githubJob}
 * @returns the source job, or the org-resolution error
 */
export function githubOrgJob({
  options,
  window,
  home,
  onRepoProgress,
  ignoreRepoCursors = false,
  cursorIsolated = false,
  resolveToken = githubToken,
}: {
  options: RefreshOptions;
  window: ExportWindow;
  home: string;
  onRepoProgress?: OrgRepoProgress;
  ignoreRepoCursors?: boolean;
  cursorIsolated?: boolean;
  resolveToken?: GithubTokenResolver;
}): Result<SourceIngestJob> {
  const orgResult = resolveGithubOrg({ options });
  if (orgResult.isErr()) {
    return err(orgResult.error);
  }
  const org = orgResult.value;
  const token = resolveToken({ home });
  const enrich = !options.noEnrich && token !== undefined;
  if (token === undefined) {
    logger.warn({ msg: "no GitHub auth (set GITHUB_TOKEN or run `gh auth login`) — org mode limited to public repos" });
  }
  return ok({
    label: `org:${org} (all-repos)`,
    run: () =>
      runGithubOrgActivity({
        cursorIsolated,
        enrich,
        home,
        ignoreRepoCursors,
        options,
        org,
        window,
        ...(token !== undefined ? { token } : {}),
        ...(onRepoProgress !== undefined ? { onRepoProgress } : {}),
      }),
    source: "github",
    window,
  });
}

/** Enumerate the org's repos then fan the per-repo pipeline over them, advancing each repo's own watermark. */
// max-lines-exempt: one crawl with two cursor stores to withhold; splitting it would hide which of the two an isolated run skips
async function runGithubOrgActivity({
  org,
  options,
  window,
  home,
  enrich,
  token,
  onRepoProgress,
  ignoreRepoCursors,
  cursorIsolated,
}: {
  org: string;
  options: RefreshOptions;
  window: ExportWindow;
  home: string;
  enrich: boolean;
  token?: string;
  onRepoProgress?: OrgRepoProgress;
  ignoreRepoCursors: boolean;
  cursorIsolated: boolean;
}): Promise<
  Result<{
    records: readonly CorpusRecord[];
    warnings: readonly string[];
    notes: readonly string[];
    committedPerContainer: number;
    projectedPerContainer: number;
    committedCursor?: string;
  }>
> {
  const pageCap = githubPageCapOf({ options });
  const enumerated = await enumerateOrgRepos({
    api: makeGithubOrgApi({ pageCap, token }),
    cap: options.repoCap,
    exclude: options.excludeRepos,
    include: options.includeRepos,
    org,
    pageCap,
  });
  if (enumerated.isErr()) {
    return err([enumerated.error.message]);
  }
  // An explicit window must beat BOTH cursor stores. `fetchOrgActivity` windows each repo from its own
  // cursor whenever one is present (a present cursor wins unconditionally — it is not a floor), so the only
  // way an explicit `--since`/`--all`/`--lookback-days` survives to the fetch is to withhold the cursors.
  const repoCursors = ignoreRepoCursors ? new Map<string, string>() : readGithubRepoWatermarks({ home });
  // ONE committer for the whole fan-out, shared across `ORG_CONCURRENCY` interleaved callers. Why that is
  // safe, and the invariant that keeps it safe, is on `githubRunCommitter`.
  const committer = githubRunCommitter({
    bounded: options.sample !== undefined || options.fetchCap !== undefined,
    cursorIsolated,
    home,
    window,
  });
  const activity = await fetchOrgActivity({
    concurrency: ORG_CONCURRENCY,
    fetchItems: githubFetchItems({ enrich, ...(token !== undefined ? { token } : {}) }),
    ratePerSec: ORG_RATE_PER_SEC,
    repoCursors,
    repos: enumerated.value.repos,
    window,
    ...(onRepoProgress !== undefined ? { onProgress: onRepoProgress } : {}),
    ...(committer !== undefined ? { onRepoCommit: committer.commitRepo } : {}),
  });
  // A sampled run must NOT persist the per-repo resume cursors either (they're a SECOND resume store beside
  // the per-source watermark) — else a later full org refresh would resume past the sampled tip and skip the
  // un-sampled remainder. Skip the advance when sampled; a sampled org run is read-only w.r.t. resume state.
  // A CURSOR-ISOLATED run must not persist them either, and it is a THIRD reason rather than the same one
  // wearing a hat. `--sample` withholds because the run saw a prefix of its window; a store load withholds
  // because it is not the file corpus's crawl at all — it fetches into the Supabase store and must leave
  // every resume store on disk exactly as it found it, in BOTH directions. `ignoreRepoCursors` is the read
  // half and this is the write half; a run that read past its cursor and then advanced it would move the
  // file corpus's own resume point on behalf of a load that wrote none of those files.
  //
  // With a committer present this list carries ONLY the repos it did not bank — a banked repo's cursor was
  // written the instant its bronze commit landed, which is the whole point: a pass killed at repo 40 of 300
  // now resumes past those 40 instead of re-reading them.
  const advanced =
    options.sample !== undefined || cursorIsolated
      ? ok(undefined)
      : advanceGithubRepoWatermarks({ advances: activity.advances, home });
  const tally = committer?.tally();
  return ok({
    committedPerContainer: tally === undefined ? 0 : tally.written,
    notes: githubDurabilityNotes({ tally }),
    projectedPerContainer: tally === undefined ? 0 : tally.projected,
    records: activity.records,
    warnings: [
      ...enumerated.value.warnings,
      `github org mode: ${String(enumerated.value.repos.length)} repo(s) selected`,
      ...activity.warnings,
      ...(advanced.isOk() ? [] : advanced.error.map((e) => `per-repo watermark persist failed: ${e}`)),
    ],
    ...(tally?.committedCursor !== undefined ? { committedCursor: tally.committedCursor } : {}),
  });
}
