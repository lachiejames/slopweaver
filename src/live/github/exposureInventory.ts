/**
 * `github exposure inventory` — count what every surface of a repository holds, and say which surface could not be
 * counted, over the closed call table in `./exposureModel.ts`.
 *
 * It reads and counts; it carries no body, identity, ref name or excerpt into its result. The sweep that scans
 * that text is a separate verb, and what it finds stays in the state home.
 *
 * The read runs in three phases over the repository document: the text threads (pull requests, issues, every comment
 * kind, reviews, releases and the uploads they reference), the CI surfaces fanned out over commits and runs, and the
 * project metadata. Each single surface is read by `./exposureSurfaces.ts`.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubExposureGitReading, type GithubExposurePull, readGithubExposureGit } from "./exposureGit.js";
import {
  countingSeam,
  type GithubExposureListing,
  type GithubExposureSeam,
  listingGaps,
  numberAt,
  stringAt,
  surfaceState,
} from "./exposureListing.js";
import {
  GITHUB_EXPOSURE_SURFACES,
  type GithubExposureInventory,
  type GithubExposureReadFailure,
  type GithubExposureSurfaceId,
  type GithubExposureSurfaceResult,
} from "./exposureModel.js";
import {
  bodiesOf,
  discussionsResult,
  eventsResult,
  fannedSurface,
  listedSurface,
  pagesResult,
  settingsResult,
  wikiResult,
} from "./exposureSurfaces.js";
import { referencedUploads } from "./exposureUploads.js";

/** The page ceiling per listing: 3,000 items, far past this repository's size, and a stated ceiling past it. */
const EXPOSURE_MAX_PAGES = 30;

/** What every phase reads with: the counted seam, the page ceiling and the repository's route parameters. */
interface PhaseContext {
  readonly seam: GithubExposureSeam;
  readonly maxPages: number;
  readonly base: { readonly owner: string; readonly repo: string };
}

/** A plain item count, the detail most listings carry. */
function itemCount({ items }: { items: readonly unknown[] }): string {
  return `${String(items.length)} item(s)`;
}

/** Issues, split from the pull-request records the issues listing also returns. */
function issuesDetail({ items }: { items: readonly unknown[] }): string {
  const pullShaped = items.filter((item) => isRecord(item) && "pull_request" in item).length;
  return `${String(items.length - pullShaped)} issue(s); ${String(pullShaped)} pull request record(s) the pull listing also counts`;
}

/** Releases, split into the published ones and the drafts that stay private, with their assets. */
function releasesDetail({ items }: { items: readonly unknown[] }): string {
  const drafts = items.filter((item) => isRecord(item) && item["draft"] === true).length;
  let assets = 0;
  for (const item of items) {
    if (isRecord(item) && Array.isArray(item["assets"])) {
      assets += item["assets"].length;
    }
  }
  return `${String(items.length - drafts)} published, ${String(drafts)} draft(s) that stay private; ${String(assets)} asset(s)`;
}

/** The pull requests the git half probes for a head ref, from the pull listing. */
function pullFactsOf({ items }: { items: readonly unknown[] }): GithubExposurePull[] {
  return items.flatMap((item) => {
    const number = numberAt({ path: ["number"], value: item });
    return number === undefined ? [] : [{ headBranch: stringAt({ path: ["head", "ref"], value: item }), number }];
  });
}

/**
 * The text threads: pull requests (and through them the git half), issues, every comment kind, reviews, releases,
 * and the uploads all of that text references.
 */
async function threadSurfaces({ context }: { context: PhaseContext }): Promise<{
  git: GithubExposureGitReading;
  results: readonly GithubExposureSurfaceResult[];
}> {
  const { base } = context;
  const page = { maxPages: context.maxPages, seam: context.seam };
  const all = { ...base, state: "all" };
  const pulls = await listedSurface({
    ...page,
    call: "pulls",
    detail: itemCount,
    params: all,
    surface: "pull-requests",
  });
  const pullFacts = pullFactsOf({ items: pulls.listing.items });
  const git = await readGithubExposureGit({
    ...base,
    ...page,
    pulls: pullFacts,
    pullsComplete: pulls.listing.outcome === "complete",
  });
  const issues = await listedSurface({ ...page, call: "issues", detail: issuesDetail, params: all, surface: "issues" });
  const comments = { ...page, detail: itemCount, params: base };
  const issueComments = await listedSurface({ ...comments, call: "issue-comments", surface: "issue-comments" });
  const reviewComments = await listedSurface({ ...comments, call: "review-comments", surface: "review-comments" });
  const commitComments = await listedSurface({ ...comments, call: "commit-comments", surface: "commit-comments" });
  const reviews = await fannedSurface({
    ...page,
    call: "pull-reviews",
    detail: ({ items, parents }) =>
      `${String(items.length)} review(s), ${String(bodiesOf({ items }).filter((body) => body.length > 0).length)} with a body, over ${String(parents)} pull request(s)`,
    parentGaps: listingGaps({ label: "pull-requests", listing: pulls.listing }),
    parents: pullFacts.map((pull) => ({ ...base, pull_number: pull.number })),
    surface: "pull-reviews",
  });
  const releases = await listedSurface({
    ...page,
    call: "releases",
    detail: releasesDetail,
    params: base,
    surface: "releases",
  });
  const listed = [pulls, issues, issueComments, reviewComments, commitComments, releases];
  return {
    git,
    results: [
      ...git.results,
      ...listed.map((surface) => surface.result),
      reviews.result,
      attachmentsResult({ reviews, textListings: listed.map((surface) => surface.listing) }),
    ],
  };
}

/** The uploads every read text references, counted, with the gaps of every listing that text came from. */
function attachmentsResult({
  textListings,
  reviews,
}: {
  textListings: readonly GithubExposureListing[];
  reviews: { result: GithubExposureSurfaceResult; items: readonly unknown[] };
}): GithubExposureSurfaceResult {
  const uploads = referencedUploads({
    texts: [
      ...textListings.flatMap((listing) => bodiesOf({ items: listing.items })),
      ...bodiesOf({ items: reviews.items }),
    ],
  });
  return {
    state: surfaceState({
      count: uploads.length,
      detail: `${String(uploads.length)} distinct uploaded asset(s) referenced`,
      gaps: [
        ...textListings.flatMap((listing) => listingGaps({ label: "a text listing", listing })),
        ...(reviews.result.state.kind === "counted" ? [] : ["the review listing was incomplete"]),
      ],
      limits: ["an upload no read text references cannot be enumerated"],
    }),
    surface: "attachments",
  };
}

/** The CI surfaces: statuses and check runs on every commit, then workflows, runs, each run's jobs and artifacts. */
async function ciSurfaces({
  context,
  git,
}: {
  context: PhaseContext;
  git: GithubExposureGitReading;
}): Promise<readonly GithubExposureSurfaceResult[]> {
  const { base } = context;
  const page = { maxPages: context.maxPages, seam: context.seam };
  const perCommit = { parentGaps: git.commitGaps, parents: git.commitShas.map((sha) => ({ ...base, ref: sha })) };
  const statuses = await fannedSurface({
    ...page,
    ...perCommit,
    call: "commit-statuses",
    detail: ({ items, parents }) => `${String(items.length)} status(es) over ${String(parents)} commit(s)`,
    surface: "commit-statuses",
  });
  const checkRuns = await fannedSurface({
    ...page,
    ...perCommit,
    call: "check-runs",
    detail: ({ items, parents }) => `${String(items.length)} check run(s) over ${String(parents)} commit(s)`,
    surface: "check-runs",
  });
  const workflows = await listedSurface({
    ...page,
    call: "actions-workflows",
    detail: itemCount,
    params: base,
    surface: "actions-workflows",
  });
  const runs = await listedSurface({
    ...page,
    call: "actions-runs",
    detail: itemCount,
    params: base,
    surface: "actions-runs",
  });
  const jobs = await fannedSurface({
    ...page,
    call: "actions-jobs",
    detail: ({ items, parents }) => `${String(items.length)} job(s), each with a log, over ${String(parents)} run(s)`,
    parentGaps: listingGaps({ label: "actions-runs", listing: runs.listing }),
    parents: runs.listing.items.flatMap((run) => {
      const id = numberAt({ path: ["id"], value: run });
      return id === undefined ? [] : [{ ...base, filter: "all", run_id: id }];
    }),
    surface: "actions-jobs",
  });
  const artifacts = await listedSurface({
    ...page,
    call: "actions-artifacts",
    detail: ({ items }) =>
      `${String(items.length)} artifact(s), ${String(items.filter((item) => isRecord(item) && item["expired"] === true).length)} expired`,
    params: base,
    surface: "actions-artifacts",
  });
  return [statuses.result, checkRuns.result, workflows.result, runs.result, jobs.result, artifacts.result];
}

/** The project metadata: labels, milestones, deployments and environments. */
async function metadataSurfaces({
  context,
}: {
  context: PhaseContext;
}): Promise<readonly GithubExposureSurfaceResult[]> {
  const { base } = context;
  const page = { detail: itemCount, maxPages: context.maxPages, seam: context.seam };
  // One read at a time, in this order: the inventory never fans out in parallel.
  const labels = await listedSurface({ ...page, call: "labels", params: base, surface: "labels" });
  const milestones = await listedSurface({
    ...page,
    call: "milestones",
    params: { ...base, state: "all" },
    surface: "milestones",
  });
  const deployments = await listedSurface({ ...page, call: "deployments", params: base, surface: "deployments" });
  const environments = await listedSurface({ ...page, call: "environments", params: base, surface: "environments" });
  return [labels.result, milestones.result, deployments.result, environments.result];
}

/** The results in the closed print order. */
function inPrintOrder({ results }: { results: readonly GithubExposureSurfaceResult[] }): GithubExposureSurfaceResult[] {
  const order = new Map<GithubExposureSurfaceId, number>(
    GITHUB_EXPOSURE_SURFACES.map((surface, index) => [surface, index]),
  );
  // Every id in `results` is a member of the closed list, so each lookup is defined.
  return results.toSorted((left, right) => order.get(left.surface)! - order.get(right.surface)!);
}

/**
 * Inventory every surface of one repository.
 *
 * @param seam the read seam
 * @param owner the repository owner
 * @param repo the repository name
 * @param nowIso the clock, read once for `readAtIso`
 * @param maxPages the page ceiling per listing
 * @returns the inventory, or the failure to read the repository document every other surface depends on
 */
export async function inventoryGithubExposure({
  seam: rawSeam,
  owner,
  repo,
  nowIso,
  maxPages = EXPOSURE_MAX_PAGES,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  nowIso: () => string;
  maxPages?: number;
}): Promise<Result<GithubExposureInventory, GithubExposureReadFailure>> {
  const { seam, calls } = countingSeam({ seam: rawSeam });
  const readAtIso = nowIso();
  const repositoryRead = await seam.get({ call: "repository", params: { owner, repo } });
  if (repositoryRead.isErr()) {
    return err(repositoryRead.error);
  }
  const repository = repositoryRead.value;
  const base = { owner, repo };
  const context: PhaseContext = { base, maxPages, seam };
  const threads = await threadSurfaces({ context });
  const results: GithubExposureSurfaceResult[] = [
    settingsResult({ repository }),
    ...threads.results,
    ...(await ciSurfaces({ context, git: threads.git })),
    ...(await metadataSurfaces({ context })),
    await discussionsResult({ ...base, repository, seam }),
    await pagesResult({ ...base, repository, seam }),
    wikiResult({ repository }),
    await eventsResult({ ...base, seam }),
  ];
  return ok({ calls: calls(), readAtIso, repository: `${owner}/${repo}`, surfaces: inPrintOrder({ results }) });
}
