/**
 * A repository's description — read and write, split out of `./write.ts` to keep it under the repo's
 * 700-code-line file-size ratchet (`src/devLint/fileSizeRatchet.ts`).
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef, WriteCtx } from "./write.js";

/** A repository's description, as GitHub reports or stores it. `undefined` mirrors GitHub's own `null`. */
export interface RepoDescriptionState {
  readonly description: string | undefined;
  readonly htmlUrl: string;
}

/**
 * The description state a repository payload carries. GitHub sends `null` for a repository with no
 * description, which this reads as absent; the repository's own URL is required and read directly.
 */
function descriptionStateOf({
  data,
}: {
  data: { readonly description: string | null; readonly html_url: string };
}): RepoDescriptionState {
  if (data.description === null) {
    return { description: undefined, htmlUrl: data.html_url };
  }
  return { description: data.description, htmlUrl: data.html_url };
}

/**
 * Read a repository's description. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository to read
 * @returns the live description and the repository's own URL
 */
export function getRepoDescriptionVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<RepoDescriptionState, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.get({ owner, repo });
      return descriptionStateOf({ data: res.data });
    },
    operation: "github.repos.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Replace a repository's description. Sent once; the caller confirms it with a separate read-back.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository and its new description
 * @returns the description GitHub stored and the repository's own URL
 */
export function setRepoDescriptionVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { description: string };
}): ResultAsync<RepoDescriptionState, IngestError> {
  const { owner, repo, description } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.update({ description, owner, repo });
      return descriptionStateOf({ data: res.data });
    },
    operation: "github.repos.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
