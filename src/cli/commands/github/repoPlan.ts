/**
 * The pure half of `github repo`'s administration writes: what one rename, transfer or archive would change,
 * whether it is already done, and the digest a preview prints and `--approve` must quote back.
 *
 * The digest is the `slopweaver gcp` shape (`../../../gcp/plan.ts`): a stable stringify of the plan view, sha256,
 * the first 16 hex characters, prefixed. It binds the repository's IMMUTABLE id beside its live address, because
 * GitHub redirects an old slug after a rename or transfer — a digest of the typed address alone could approve a
 * write landing on a repository other than the one the preview showed. It does NOT bind the destination
 * account's id: a transfer's `newOwner` is the exact login typed, so a typo previewed and approved is a typo sent.
 */

import { sha256Hex } from "#lib/hash.js";
import { stableStringify } from "#lib/stableStringify.js";
import type { RepoAdministrationState } from "../../../outbound/github/repoAdministration.js";

/** One administration write. Exactly one per invocation: a rename and a transfer are two approvals. */
export type GithubRepoAdministrationAction =
  | { readonly kind: "rename"; readonly newName: string }
  | { readonly kind: "transfer"; readonly newOwner: string }
  | { readonly kind: "archive" };

/** One previewed write: the address typed, the state read there, the action, and where the repository ends up. */
export interface GithubRepoAdministrationPlan {
  readonly source: { readonly owner: string; readonly repo: string };
  readonly current: RepoAdministrationState;
  readonly action: GithubRepoAdministrationAction;
  readonly targetFullName: string;
}

/** The prefix every administration digest carries, so it can never be mistaken for a `gcp-` approval. */
const GITHUB_REPO_DIGEST_PREFIX = "ghrepo-";

/** The shape `--approve` must take: the prefix and exactly 16 lowercase hex characters. */
export const GITHUB_REPO_DIGEST_PATTERN = /^ghrepo-[0-9a-f]{16}$/;

/**
 * Where the repository ends up after the action, as `owner/name`.
 *
 * @param current the live state the action starts from
 * @param action the one write
 * @returns the full name a read-back must find
 */
function targetFullNameOf({
  current,
  action,
}: {
  current: RepoAdministrationState;
  action: GithubRepoAdministrationAction;
}): string {
  switch (action.kind) {
    case "rename":
      return `${current.ownerLogin}/${action.newName}`;
    case "transfer":
      return `${action.newOwner}/${current.name}`;
    case "archive":
      return current.fullName;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/**
 * Build the plan for one action over the state just read.
 *
 * @param source the address the caller typed
 * @param current the live state read at that address
 * @param action the one write
 * @returns the plan a preview prints and a digest binds
 */
export function planRepoAdministration({
  source,
  current,
  action,
}: {
  source: { owner: string; repo: string };
  current: RepoAdministrationState;
  action: GithubRepoAdministrationAction;
}): GithubRepoAdministrationPlan {
  return { action, current, source, targetFullName: targetFullNameOf({ action, current }) };
}

/**
 * Whether the repository already stands where the action would put it, so nothing is previewed or sent.
 *
 * A rename compares names exactly — a case-only rename is a real write. A transfer compares owner logins
 * case-insensitively, as GitHub does. An archive is done once `archived` is true.
 *
 * @param plan the plan over the live state
 * @returns true when sending the action would change nothing
 */
export function isAlreadyDone({ plan }: { plan: GithubRepoAdministrationPlan }): boolean {
  const { action, current } = plan;
  switch (action.kind) {
    case "rename":
      return current.name === action.newName;
    case "transfer":
      return current.ownerLogin.toLowerCase() === action.newOwner.toLowerCase();
    case "archive":
      return current.archived;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/**
 * The fields the digest binds and a `--json` preview prints: everything that changes what is sent, and nothing
 * that does not (the URL, the output mode, the home, the approval itself).
 *
 * @param plan the plan over the live state
 * @returns a plain, stably stringifiable view
 */
export function githubRepoPlanView({
  plan,
}: {
  plan: GithubRepoAdministrationPlan;
}): Readonly<Record<string, unknown>> {
  return {
    action: plan.action,
    current: {
      archived: plan.current.archived,
      fullName: plan.current.fullName,
      id: plan.current.id,
      name: plan.current.name,
      ownerLogin: plan.current.ownerLogin,
    },
    source: `${plan.source.owner}/${plan.source.repo}`,
    target: plan.targetFullName,
  };
}

/**
 * The approval digest of one plan.
 *
 * @param plan the plan over the live state
 * @returns `ghrepo-` and the first 16 hex characters of the view's sha256
 */
export function githubRepoWriteDigest({ plan }: { plan: GithubRepoAdministrationPlan }): string {
  return githubRepoViewDigest({ view: githubRepoPlanView({ plan }) });
}

/**
 * The approval digest of any `github repo` plan view — the one recipe every approval-gated repository write shares,
 * so a create, a visibility change and an Actions policy each print and accept the same `ghrepo-` shape.
 *
 * @param view the plain view a preview prints: every field that changes what is sent, and nothing else
 * @returns `ghrepo-` and the first 16 hex characters of the view's sha256
 */
export function githubRepoViewDigest({ view }: { view: Readonly<Record<string, unknown>> }): string {
  return `${GITHUB_REPO_DIGEST_PREFIX}${sha256Hex({ bytes: stableStringify({ value: view }) }).slice(0, 16)}`;
}
