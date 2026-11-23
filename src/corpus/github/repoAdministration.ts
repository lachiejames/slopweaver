/**
 * A repository's identity and archive state — read, and the three irreversible administration writes: rename,
 * transfer to another owner, archive. Held on the write lane's context (`./writeCtx.ts`): SDK retries off and
 * redirects unfollowed, so each write is sent once and a read of a moved address fails rather than silently
 * answering for the repository it moved to. `../../outbound/github/repoAdministration.ts` builds that context
 * itself rather than adding to `./write.ts`, which sits at the file-size ratchet's cap.
 *
 * None of these writes returns proof of its own outcome: the caller confirms each with a fresh read keyed on the
 * repository's immutable id. A transfer especially — GitHub answers `202 Accepted` with the ORIGINAL owner while
 * the move completes asynchronously, so its response body is never read as the result.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** What a repository administration write is judged against: who it is, where it is, and whether it is archived. */
export interface RepoAdministrationState {
  /** GitHub's immutable repository id — the one field a rename or transfer cannot change. */
  readonly id: number;
  readonly name: string;
  readonly ownerLogin: string;
  readonly fullName: string;
  readonly archived: boolean;
  readonly htmlUrl: string;
}

/**
 * Read a repository's identity and archive state. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository address to read; a moved address is an error, never the repository it moved to
 * @returns the live state
 */
export function getRepoAdministrationVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<RepoAdministrationState, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.get({ owner, repo });
      return {
        archived: res.data.archived,
        fullName: res.data.full_name,
        htmlUrl: res.data.html_url,
        id: res.data.id,
        name: res.data.name,
        ownerLogin: res.data.owner.login,
      };
    },
    operation: "github.repos.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Rename a repository within its owner. Sent once; the caller confirms it by reading the new address.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the name it takes
 * @returns nothing on GitHub's acceptance
 */
export function renameRepoVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly newName: string };
}): ResultAsync<void, IngestError> {
  const { owner, repo, newName } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.update({ name: newName, owner, repo });
    },
    operation: "github.repos.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Archive a repository. Sent once; the caller confirms it by reading `archived` back.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to archive
 * @returns nothing on GitHub's acceptance
 */
export function archiveRepoVia({ ctx, input }: { ctx: WriteCtx; input: RepoRef }): ResultAsync<void, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.update({ archived: true, owner, repo });
    },
    operation: "github.repos.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Ask GitHub to transfer a repository to another owner, keeping its name. Sent once. GitHub answers
 * `202 Accepted` and completes the move asynchronously, so the response is discarded and the caller polls the
 * destination address instead.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the account or organisation login that receives it
 * @returns nothing on GitHub's acceptance
 */
export function transferRepoVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly newOwner: string };
}): ResultAsync<void, IngestError> {
  const { owner, repo, newOwner } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.transfer({ new_owner: newOwner, owner, repo });
    },
    operation: "github.repos.transfer",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
