/**
 * `github exposure` — the closed model of what a private repository exposes the moment it is switched public.
 *
 * ## The call table is the only source of a request
 *
 * {@link GITHUB_EXPOSURE_CALLS} maps a closed set of call ids to literal GET routes. The read seam a caller hands
 * the inventory takes a CALL ID, never a route or a method, so no argument reaches an endpoint this table does not
 * list, and nothing here can write: every row is a GET. `./exposureRead.ts` is the one place an id becomes a route.
 *
 * ## A zero is a measurement or it is not printed
 *
 * Each surface lands in exactly one {@link GithubExposureState}. `counted` carries an EXACT count over everything the
 * API can enumerate, plus the limits the API itself imposes (an upload never referenced in any text cannot be
 * listed; the events feed holds at most 300). `partial` carries an observed LOWER BOUND and why it stopped — a page
 * ceiling, a truncated tree, a failed page mid-listing. `not-enabled` is only ever decided from the repository
 * document's own flag, never from a 404, because GitHub answers concealment and absence with the same status.
 */

/** Every GET this verb may make, by id. The route is what Octokit's `request` takes, verbatim. */
export const GITHUB_EXPOSURE_CALLS = {
  "actions-artifacts": { itemsKey: "artifacts", route: "GET /repos/{owner}/{repo}/actions/artifacts" },
  "actions-jobs": { itemsKey: "jobs", route: "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs" },
  "actions-runs": { itemsKey: "workflow_runs", route: "GET /repos/{owner}/{repo}/actions/runs" },
  "actions-workflows": { itemsKey: "workflows", route: "GET /repos/{owner}/{repo}/actions/workflows" },
  "check-runs": { itemsKey: "check_runs", route: "GET /repos/{owner}/{repo}/commits/{ref}/check-runs" },
  "commit-comments": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/comments" },
  "commit-detail": { itemsKey: "files", route: "GET /repos/{owner}/{repo}/commits/{ref}" },
  "commit-statuses": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/commits/{ref}/statuses" },
  commits: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/commits" },
  deployments: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/deployments" },
  environments: { itemsKey: "environments", route: "GET /repos/{owner}/{repo}/environments" },
  events: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/events" },
  "git-blob": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/git/blobs/{file_sha}" },
  "git-ref": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/git/ref/{ref}" },
  "git-tree": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/git/trees/{tree_sha}" },
  "issue-comments": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/issues/comments" },
  issues: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/issues" },
  labels: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/labels" },
  "matching-refs": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/git/matching-refs/{ref}" },
  milestones: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/milestones" },
  pages: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/pages" },
  "pull-reviews": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews" },
  pulls: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/pulls" },
  releases: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/releases" },
  repository: { itemsKey: undefined, route: "GET /repos/{owner}/{repo}" },
  "review-comments": { itemsKey: undefined, route: "GET /repos/{owner}/{repo}/pulls/comments" },
} as const satisfies Readonly<
  Record<string, { readonly itemsKey: string | undefined; readonly route: `GET ${string}` }>
>;

/** One admitted REST call id. */
export type GithubExposureCallId = keyof typeof GITHUB_EXPOSURE_CALLS;

/**
 * The listings GitHub answers WHOLE in one response, ignoring `page`. Paging one of these would read the same list
 * again on page two and loop to the ceiling, so it is read once.
 */
export const GITHUB_EXPOSURE_UNPAGED_CALLS: ReadonlySet<GithubExposureCallId> = new Set<GithubExposureCallId>([
  "matching-refs",
]);

/**
 * The one GraphQL read: every discussion's text, its comments' and their replies', each connection with its own
 * total so a cut-off is a gap rather than a silent end. The widths keep the query under GitHub's 500,000-node
 * limit (100 + 100×50 + 100×50×10 = 55,100).
 */
export const GITHUB_EXPOSURE_DISCUSSIONS_QUERY = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    discussions(first: 100) {
      totalCount
      nodes {
        number title body
        comments(first: 50) { totalCount nodes { body replies(first: 10) { totalCount nodes { body } } } }
      }
    }
  }
}`;

/** How many blobs one blob query reads: small enough that a batch of large text files stays a modest response. */
export const GITHUB_EXPOSURE_BLOB_BATCH = 50;

/**
 * The read of up to {@link GITHUB_EXPOSURE_BLOB_BATCH} blobs by id, each under an alias `b<i>` with its id in the
 * variable `o<i>`, so no id is ever spliced into the query text. GitHub returns `text` null for a binary blob and
 * cuts a large one off with `isTruncated`; both are read again over REST.
 *
 * @param count how many blobs this query reads
 * @returns the query text
 */
export function githubExposureBlobsQuery({ count }: { count: number }): string {
  const indexes = Array.from({ length: count }, (_, index) => index);
  const declared = indexes.map((index) => `$o${String(index)}: GitObjectID!`).join(", ");
  const read = indexes
    .map((index) => `b${String(index)}: object(oid: $o${String(index)}) { ... on Blob { isBinary isTruncated text } }`)
    .join("\n    ");
  return `query($owner: String!, $repo: String!, ${declared}) {\n  repository(owner: $owner, name: $repo) {\n    ${read}\n  }\n}`;
}

/** Every surface the inventory reports, in print order. A surface absent from a report is a defect, never a zero. */
export const GITHUB_EXPOSURE_SURFACES = [
  "repository-settings",
  "refs",
  "pull-refs-of-deleted-branches",
  "commits",
  "commit-identities",
  "file-history",
  "pull-requests",
  "issues",
  "issue-comments",
  "pull-reviews",
  "review-comments",
  "commit-comments",
  "attachments",
  "commit-statuses",
  "check-runs",
  "actions-workflows",
  "actions-runs",
  "actions-jobs",
  "actions-artifacts",
  "releases",
  "labels",
  "milestones",
  "deployments",
  "environments",
  "discussions",
  "pages",
  "wiki",
  "events",
] as const;

/** One reported surface. */
export type GithubExposureSurfaceId = (typeof GITHUB_EXPOSURE_SURFACES)[number];

/** What one surface's read established. */
export type GithubExposureState =
  | {
      readonly kind: "counted";
      readonly count: number;
      readonly detail: string;
      /** What the API itself cannot enumerate; never a gap this read left. */
      readonly limits: readonly string[];
    }
  | {
      readonly kind: "partial";
      readonly observedAtLeast: number;
      readonly detail: string;
      readonly why: readonly string[];
    }
  | { readonly kind: "not-enabled"; readonly detail: string }
  | { readonly kind: "not-readable-by-api"; readonly detail: string }
  | { readonly kind: "read-failed"; readonly detail: string; readonly why: readonly string[] };

/** One surface with its state. */
export interface GithubExposureSurfaceResult {
  readonly surface: GithubExposureSurfaceId;
  readonly state: GithubExposureState;
}

/** The whole inventory: counts only — no identity, body, ref name or excerpt is ever carried here. */
export interface GithubExposureInventory {
  readonly repository: string;
  readonly readAtIso: string;
  readonly calls: number;
  readonly surfaces: readonly GithubExposureSurfaceResult[];
}

/** A read the seam could not make, with GitHub's status when there was one. */
export interface GithubExposureReadFailure {
  readonly status: number | undefined;
  readonly message: string;
}
