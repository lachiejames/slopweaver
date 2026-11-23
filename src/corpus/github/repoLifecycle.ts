/**
 * A repository's lifecycle on GitHub — who may own a new one, creating it, and making it public — on the write
 * lane's context (`./writeCtx.ts`): SDK retries off and redirects unfollowed, so each write is sent once and a
 * read of a moved address fails rather than answering for the repository it moved to. The one repeat this lane
 * cannot stop is undici re-sending after an HTTP 421, which by specification the server did not handle
 * (pinned in `src/__tests__/integration/githubWriteTransport.test.ts`); it applies here as to every write. Beside
 * `./repoAdministration.ts` rather than inside it, because that module's state is what the rename, transfer and
 * archive digests bind, and widening it would change every one of their approvals.
 *
 * No write here returns proof of its own outcome. A create hands back the new repository's immutable id, which
 * the caller then requires a fresh read of the address to show; a visibility change is confirmed by reading it.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** What a create or visibility write is judged against. */
export interface RepoLifecycleState {
  /** GitHub's immutable repository id. */
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly ownerLogin: string;
  /** The owning account's type as GitHub reports it: `User` or `Organization`. */
  readonly ownerType: string;
  readonly private: boolean;
  /** `public`, `private` or `internal`, as GitHub reports it. */
  readonly visibility: string;
  readonly archived: boolean;
  readonly htmlUrl: string;
}

/** An account GitHub knows, as a create resolves its owner. */
export interface GithubAccount {
  readonly id: number;
  readonly login: string;
  /** `User`, `Organization` or `Bot`, as GitHub reports it. */
  readonly type: string;
}

/**
 * Read a repository's lifecycle state. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository address; a moved address is an error, never the repository it moved to
 * @returns the live state, or the provider's failure (a 404 when nothing stands at the address)
 */
export function getRepoLifecycleVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<RepoLifecycleState, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.get({ owner, repo });
      const { visibility } = res.data;
      // The SDK types `visibility` optional; a body without it must never read as public or private by default.
      if (typeof visibility !== "string") {
        throw new Error(`GitHub's read of ${owner}/${repo} carried no visibility, so whether it is public is unknown`);
      }
      return {
        archived: res.data.archived,
        fullName: res.data.full_name,
        htmlUrl: res.data.html_url,
        id: res.data.id,
        name: res.data.name,
        ownerLogin: res.data.owner.login,
        ownerType: res.data.owner.type,
        private: res.data.private,
        visibility,
      };
    },
    operation: "github.repos.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read the account the token belongs to.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @returns the token owner's id, login and type
 */
export function getAuthenticatedAccountVia({ ctx }: { ctx: WriteCtx }): ResultAsync<GithubAccount, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.users.getAuthenticated();
      return { id: res.data.id, login: res.data.login, type: res.data.type };
    },
    operation: "github.users.getAuthenticated",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read any account by login, to tell a user from an organisation.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param login the account login to read
 * @returns the account's id, login and type
 */
export function getAccountVia({
  ctx,
  login,
}: {
  ctx: WriteCtx;
  login: string;
}): ResultAsync<GithubAccount, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.users.getByUsername({ username: login });
      return { id: res.data.id, login: res.data.login, type: res.data.type };
    },
    operation: "github.users.getByUsername",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Create a repository for the token's own account, or in an organisation. Sent once, with exactly the name and
 * the privacy flag: no template, initial commit, description or feature default is added on the caller's behalf.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the organisation login when the owner is one (absent for the token's own account), the name, and
 *   whether the repository is private
 * @returns the new repository's immutable id on GitHub's acceptance — correlation for the read-back, not proof
 */
export function createRepoVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { readonly org: string | undefined; readonly name: string; readonly private: boolean };
}): ResultAsync<{ readonly id: number }, IngestError> {
  const { org, name } = input;
  const isPrivate = input.private;
  if (org === undefined) {
    return safeProviderCall({
      execute: async () => {
        const res = await ctx.client.rest.repos.createForAuthenticatedUser({ name, private: isPrivate });
        return { id: res.data.id };
      },
      operation: "github.repos.createForAuthenticatedUser",
      provider: "github",
      retryMode: "never",
      scopeId: ctx.scopeId,
    });
  }
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.createInOrg({ name, org, private: isPrivate });
      return { id: res.data.id };
    },
    operation: "github.repos.createInOrg",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Make a repository public. Sent once; the caller confirms it by reading `visibility` back.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to publish
 * @returns nothing on GitHub's acceptance
 */
export function setRepoPublicVia({ ctx, input }: { ctx: WriteCtx; input: RepoRef }): ResultAsync<void, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.update({ owner, repo, visibility: "public" });
    },
    operation: "github.repos.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
