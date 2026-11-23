/**
 * The shape of one row of the GitHub atlas's closed call inventory (`./inventory.ts`), and how a row's route
 * template is filled for a scope. The rows themselves, and why the list is closed, live in that file; this one
 * holds only what a row IS, so the table can grow without the file that carries it outgrowing a reader.
 */
import type { GithubKind } from "./model.js";

/**
 * How a call's results are paged.
 *
 * `page` is GitHub's ordinary `?page=&per_page=` listing; `none` is a singleton document. There is
 * deliberately no `cursor` member: every REST listing this atlas reads is page-numbered, and GraphQL —
 * which is cursor-paged — is a declared-unfilled surface that makes no calls at all.
 *
 * @internal
 */
export const GITHUB_PAGINGS = ["none", "page"] as const;

type GithubPaging = (typeof GITHUB_PAGINGS)[number];

/**
 * Which level of GitHub's hierarchy a call is made against.
 *
 * `account` is the signed-in token itself, and exists for the two DISCOVERY calls that find what the other
 * two levels are. They are in this table rather than beside the sync for a reason a review found the hard
 * way: without them, `slopweaver atlas github sync` with no `--orgs` reached `GET /user/orgs` and
 * `GET /orgs/<org>/repos` through a route the closed list did not contain, so the property this table
 * exists to hold — no request outside it — was false for the ordinary invocation.
 */
const GITHUB_CALL_LEVELS = ["account", "organization", "repository"] as const;

export type GithubCallLevel = (typeof GITHUB_CALL_LEVELS)[number];

/**
 * One admitted GitHub call.
 *
 * `expectedRefusals` is this platform's own field and earns its place: on GitHub a 403 or 404 is the
 * ORDINARY answer for a great many rows — a plan without Advanced Security, an organisation without
 * enterprise features, a repository with Pages off — and a coverage table that graded every one of them as
 * a failure would be mostly red for an installation that is entirely healthy. Naming the expected refusal
 * lets the sync record a boundary instead of an alarm.
 */
export interface GithubCall {
  readonly id: string;
  readonly kind: GithubKind;
  readonly level: GithubCallLevel;
  readonly method: "GET";
  /** The route template, `{org}` and `{owner}/{repo}` filled from the scope this call is made for. */
  readonly path: string;
  readonly paging: GithubPaging;
  /** Status codes that mean "not here, and that is a normal state" rather than "this read failed". */
  readonly expectedRefusals: readonly number[];
  /**
   * GitHub answers this admin-gated route with a 404, not a 403, when the credential lacks the repository
   * admin or organisation owner role — so a 404 here is a permission refusal, never a missing route.
   *
   * MEASURED (`slopweaver atlas github sync --json` under a non-owner member's token): every
   * route carrying this answered 404 on every repository, while `GET /orgs/{org}` and `GET /repos/{owner}/{repo}`
   * answered 200 in the same run. Graded as `ROUTE_ABSENT`, that read as "GitHub does not serve this" and
   * the publish gate refused the generation over kinds the token was simply not permitted to see. Only a
   * sub-route of an object another call reads carries it, so a missing organisation or repository still
   * fails loudly through `org-settings` and `repo-settings`.
   */
  readonly notFoundWhenUnpermitted?: true;
  readonly whyRead: string;
}

/**
 * Fill a call's route template for one scope.
 *
 * @param call the admitted call
 * @param scopeRef the organisation login, or the `owner/repo` coordinate
 * @returns the concrete route, or `null` when the scope does not fit the call's level
 */
export function githubCallRoute({ call, scopeRef }: { call: GithubCall; scopeRef: string }): string | null {
  if (call.level === "account") {
    return call.path;
  }
  if (call.level === "organization") {
    return scopeRef.includes("/") ? null : call.path.replace("{org}", scopeRef);
  }
  const [owner, repo] = scopeRef.split("/");
  if (owner === undefined || repo === undefined || repo.length === 0) {
    return null;
  }
  return call.path.replace("{owner}", owner).replace("{repo}", repo);
}
