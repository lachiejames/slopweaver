/**
 * The GitHub org lane's network seam and its bounded page walk: the {@link GithubOrgApi} contract, the live
 * octokit implementation routing every SDK call through a `safe*` wrapper, and the page ceiling every org list
 * walks under. The orchestration over this seam is `org.ts`.
 */
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { orThrow } from "../../lib/safeBoundary.js";
import { type GithubOrgError, GithubOrgErrors } from "./errors.js";
import { type GithubClient, githubScopeId, makeGithubClient } from "./githubClient.js";

const PER_PAGE = 100;
/**
 * The default page ceiling on every org list here (repos, teams, a team's members, a team's repos): 20 pages of
 * {@link PER_PAGE} is 2,000 items per list. It bounds a runaway walk, never the org — a walk that reaches it
 * with a FULL last page is reported ({@link pageCeilingWarning}) and `--github-page-cap` raises it, so the
 * truncation announces itself instead of reading as a whole org. Measured: acme lists 22
 * repositories (`slopweaver refresh --source github --all-repos --github-org acme --sample 1`).
 */
export const DEFAULT_GITHUB_PAGE_CAP = 20;

/**
 * A bounded page walk's outcome: its items, whether the ceiling — not the data — ended it, and the ceiling it
 * walked under. The ceiling rides on the result so a warning names the one the walk ACTUALLY hit, never a
 * second number a caller happened to hold.
 */
export interface PagedList {
  readonly items: readonly unknown[];
  readonly truncated: boolean;
  readonly pageCap: number;
}

/**
 * The injected GitHub org seam. `getOrg` is non-fatal; `listTeams` returns `err` on a `read:org` scope gap.
 * The three lists the seam pages ITSELF (teams, a team's members, a team's repos) return a {@link PagedList} so
 * a ceiling hit inside the seam still reaches the caller's warnings; `listRepos` is paged by the caller.
 */
export interface GithubOrgApi {
  getOrg: (args: { org: string }) => Promise<unknown | undefined>;
  listRepos: (args: { org: string; page: number }) => Promise<readonly unknown[]>;
  listTeams: (args: { org: string }) => Promise<Result<PagedList, GithubOrgError>>;
  listTeamMembers: (args: { org: string; teamSlug: string }) => Promise<PagedList>;
  listTeamRepos: (args: { org: string; teamSlug: string }) => Promise<PagedList>;
}

/**
 * The warning a page walk that hit its ceiling deserves. Names the ceiling, what was listed and the flag that
 * raises it — the count reached is the fact a reader needs to judge how much is missing. Pure.
 *
 * @param what the list that was walked (`org repo`, `team platform members`)
 * @param listed the walk, carrying the ceiling it stopped at and how many items it holds
 * @returns the warning line
 */
export function pageCeilingWarning({ what, listed }: { what: string; listed: PagedList }): string {
  return (
    `github: ${what} enumeration stopped at the ${String(listed.pageCap)}-page ceiling with ` +
    `${String(listed.items.length)} listed and more may exist — raise it with --github-page-cap`
  );
}

/**
 * Page a {@link PER_PAGE}-sized org list to exhaustion or to `pageCap` pages, via a page fetcher, and say which
 * ended it. Pessimistic: only a page SHORTER than `per_page` proves the list was exhausted, so that is the one
 * thing that clears `truncated` — running out of pages at the ceiling with a full last page means the ceiling
 * ended the walk, not the data, and a caller must warn rather than file the prefix as the whole org. A thrown
 * page fetch propagates: which failures are fatal is the caller's decision, made at the call site.
 *
 * @param fetch the page fetcher (1-based page number in, that page's items out)
 * @param pageCap the page ceiling (`--github-page-cap`)
 * @returns the items walked, and whether the ceiling truncated them
 */
export async function pageToCeiling({
  fetch,
  pageCap,
}: {
  fetch: (page: number) => Promise<readonly unknown[]>;
  pageCap: number;
}): Promise<PagedList> {
  const items: unknown[] = [];
  let truncated = true;
  for (let page = 1; page <= pageCap; page += 1) {
    const batch = await fetch(page);
    items.push(...batch);
    if (batch.length < PER_PAGE) {
      truncated = false;
      break;
    }
  }
  return { items, pageCap, truncated };
}

/**
 * Build the production GitHub org seam over a resilient octokit client. Every SDK call is routed through a
 * `safe*` wrapper; `getOrg` degrades to undefined and `listTeams` degrades to `err` (a `read:org` scope gap
 * becomes a warning upstream, never a throw).
 *
 * @param token the GitHub token (org-admin + `read:org` needed for teams + private repos)
 * @param pageCap the page ceiling on the lists the seam pages itself (teams, members, team repos)
 * @returns the live org seam
 */
export function makeGithubOrgApi({ token, pageCap }: { token: string | undefined; pageCap: number }): GithubOrgApi {
  const client = makeGithubClient({ token });
  const scopeId = githubScopeId({ token });
  return {
    getOrg: ({ org }) => getOrgSafe({ client, org, scopeId }),
    listRepos: async ({ org, page }) =>
      orThrow({
        result: await safeProviderCall({
          execute: () => client.rest.repos.listForOrg({ org, page, per_page: PER_PAGE, type: "all" }),
          operation: "github.orgs.listRepos",
          provider: "github",
          retryMode: "never",
          scopeId,
        }),
      }).data,
    listTeamMembers: ({ org, teamSlug }) =>
      pageToCeiling({
        pageCap,
        fetch: async (page) =>
          orThrow({
            result: await safeProviderCall({
              execute: () => client.rest.teams.listMembersInOrg({ org, page, per_page: PER_PAGE, team_slug: teamSlug }),
              operation: "github.teams.listMembersInOrg",
              provider: "github",
              retryMode: "never",
              scopeId,
            }),
          }).data,
      }),
    listTeamRepos: ({ org, teamSlug }) =>
      pageToCeiling({
        pageCap,
        fetch: async (page) =>
          orThrow({
            result: await safeProviderCall({
              execute: () => client.rest.teams.listReposInOrg({ org, page, per_page: PER_PAGE, team_slug: teamSlug }),
              operation: "github.teams.listReposInOrg",
              provider: "github",
              retryMode: "never",
              scopeId,
            }),
          }).data,
      }),
    listTeams: ({ org }) => listTeamsSafe({ client, org, pageCap, scopeId }),
  };
}

/** `orgs.get` — non-fatal (a 404/blocked org yields `undefined`, not a throw). */
async function getOrgSafe({
  client,
  org,
  scopeId,
}: {
  client: GithubClient;
  scopeId: string;
  org: string;
}): Promise<unknown | undefined> {
  const res = await safeProviderCall({
    execute: () => client.rest.orgs.get({ org }),
    operation: "github.orgs.get",
    provider: "github",
    retryMode: "never",
    scopeId,
  });
  return res.isOk() ? res.value.data : undefined;
}

/** `teams.list` (paged) — `err` on a `read:org` scope gap so the caller degrades to a warning. */
async function listTeamsSafe({
  client,
  scopeId,
  org,
  pageCap,
}: {
  client: GithubClient;
  scopeId: string;
  org: string;
  pageCap: number;
}): Promise<Result<PagedList, GithubOrgError>> {
  const res = await safeProviderCall({
    execute: () =>
      pageToCeiling({
        fetch: (page) => client.rest.teams.list({ org, page, per_page: PER_PAGE }).then((r) => r.data),
        pageCap,
      }),
    operation: "github.teams.list",
    provider: "github",
    retryMode: "never",
    scopeId,
  });
  return res.isOk() ? ok(res.value) : err(GithubOrgErrors.teamsUnavailable({ reason: res.error.message }));
}
