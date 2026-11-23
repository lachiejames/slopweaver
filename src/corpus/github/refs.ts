/**
 * Git refs on the remote — a branch's tip, a tag's target, creating a tag and deleting a branch — held in
 * this lane beside `./protection.ts` and `./repoDescription.ts` so nothing outside `src/corpus/github/`
 * constructs a write client.
 *
 * Deliberately NOT members of `GithubWriteApi` (`./write.ts`): every test fake implements that interface in
 * full, so a new member would ripple through dozens of fakes that never touch a ref. The two ref verbs build
 * their own narrow surface from these functions instead (`src/outbound/github/refs.ts`).
 *
 * Reads are repeatable, so they retry transiently. Writes are sent once BY THIS CODE (`retryMode: "never"`) — a ref
 * create or delete retried after an ambiguous failure would either refuse on the ref it just made or report a 404
 * as a failure. That is not a wire guarantee: native fetch replays a request answered HTTP 421 below every retry
 * setting, for every verb on the write lane. Every write here is therefore create-if-absent or a compare-and-swap, so
 * a replay is refused by GitHub rather than applied twice, and the verbs read back what actually happened.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef, WriteCtx } from "./write.js";

/** How many annotated tags deep a peel follows before calling the chain malformed rather than looping. */
const MAX_TAG_PEEL = 8;

/** Whether a thrown provider error carries this HTTP status — a 404 is the one a ref READ answers "not there" with. */
function hasStatus({ error, status }: { error: unknown; status: number }): boolean {
  return error instanceof Object && "status" in error && error.status === status;
}

/**
 * Refuse a write answer that is not the CREATED status. The lane's client never follows a redirect, and Octokit
 * resolves an unfollowed 3xx rather than throwing, so without this a 307 would read as a write that landed.
 */
function assertCreated({ status, what }: { status: number; what: string }): void {
  if (status !== 201) {
    throw new Error(`GitHub answered ${String(status)} to ${what}, not 201 Created; nothing is assumed written`);
  }
}

/**
 * A branch's live tip, or undefined when no such branch exists on the remote.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and the branch name, without `refs/heads/`
 * @returns the tip commit sha, or undefined on a 404
 */
export function branchTipVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { branch: string };
}): ResultAsync<string | undefined, IngestError> {
  return safeProviderCall({
    execute: async () => {
      try {
        const res = await ctx.client.rest.git.getRef({
          owner: input.owner,
          ref: `heads/${input.branch}`,
          repo: input.repo,
        });
        if (res.data.object.type !== "commit") {
          throw new Error(`branch ${input.branch} points at a ${res.data.object.type}, not a commit`);
        }
        return res.data.object.sha;
      } catch (error: unknown) {
        if (hasStatus({ error, status: 404 })) {
          return undefined;
        }
        throw error;
      }
    },
    operation: "github.git.getRef",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * The repository's default branch — the one branch a delete must never touch.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository
 * @returns the default branch's name
 */
export function defaultBranchVia({ ctx, input }: { ctx: WriteCtx; input: RepoRef }): ResultAsync<string, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.get({ owner: input.owner, repo: input.repo });
      return res.data.default_branch;
    },
    operation: "github.repos.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Every OPEN pull request whose base or head is the branch — deleting the base closes them all, and deleting
 * the head closes that one.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and the branch name
 * @returns the numbers of the open pull requests that name the branch, base ones first, without duplicates
 */
export function openPrsOnBranchVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { branch: string };
}): ResultAsync<readonly number[], IngestError> {
  return safeProviderCall({
    execute: async () => {
      const [asBase, asHead] = await Promise.all([
        ctx.client.paginate(ctx.client.rest.pulls.list, {
          base: input.branch,
          owner: input.owner,
          per_page: 100,
          repo: input.repo,
          state: "open",
        }),
        ctx.client.paginate(ctx.client.rest.pulls.list, {
          head: `${input.owner}:${input.branch}`,
          owner: input.owner,
          per_page: 100,
          repo: input.repo,
          state: "open",
        }),
      ]);
      return [...new Set([...asBase, ...asHead].map((pr) => pr.number))];
    },
    operation: "github.pulls.list",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Whether the remote holds a commit — a tag may only point at one it already has, since this lane writes
 * refs and never pushes objects.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and the full commit sha
 * @returns true when the commit is on the remote, false on a 404; any other status surfaces as a failure
 */
export function commitExistsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { sha: string };
}): ResultAsync<boolean, IngestError> {
  return safeProviderCall({
    execute: async () => {
      try {
        await ctx.client.rest.git.getCommit({ commit_sha: input.sha, owner: input.owner, repo: input.repo });
        return true;
      } catch (error: unknown) {
        if (hasStatus({ error, status: 404 })) {
          return false;
        }
        throw error;
      }
    },
    operation: "github.git.getCommit",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * A tag's own ref oid and the commit it peels to, or undefined when the ref lookup 404s. The ref oid is an
 * annotation object's sha for an annotated tag — the value a compare-and-swap on the ref must name. The two
 * reads are passed in, written inside each caller's `safeProviderCall`, so no provider call runs unwrapped.
 */
async function peelTagRef({
  readRef,
  readTag,
  tag,
}: {
  readRef: () => Promise<{ type: string; sha: string }>;
  readTag: (tagSha: string) => Promise<{ type: string; sha: string }>;
  tag: string;
}): Promise<{ refOid: string; commit: string } | undefined> {
  let target: { type: string; sha: string };
  try {
    target = await readRef();
  } catch (error: unknown) {
    // Only the REF lookup's 404 means "no such tag"; a failed annotation read below must surface.
    if (hasStatus({ error, status: 404 })) {
      return undefined;
    }
    throw error;
  }
  const refOid = target.sha;
  for (let hop = 0; target.type === "tag"; hop += 1) {
    if (hop >= MAX_TAG_PEEL) {
      throw new Error(`tag ${tag} is annotated more than ${String(MAX_TAG_PEEL)} levels deep`);
    }
    target = await readTag(target.sha);
  }
  if (target.type !== "commit") {
    throw new Error(`tag ${tag} points at a ${target.type}, not a commit`);
  }
  return { commit: target.sha, refOid };
}

/**
 * The commit a tag points at, peeling an annotated tag's object, or undefined when no such tag exists.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and the tag name, without `refs/tags/`
 * @returns the peeled commit sha, or undefined on a 404
 */
export function tagCommitVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { tag: string };
}): ResultAsync<string | undefined, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const { owner, repo, tag } = input;
      const peeled = await peelTagRef({
        readRef: async () => (await ctx.client.rest.git.getRef({ owner, ref: `tags/${tag}`, repo })).data.object,
        readTag: async (tagSha) => (await ctx.client.rest.git.getTag({ owner, repo, tag_sha: tagSha })).data.object,
        tag,
      });
      return peeled?.commit;
    },
    operation: "github.git.getRef",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Create a tag ref at a commit the remote already holds — annotated when a message is given, lightweight
 * otherwise. Sent once.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository, the tag name, the commit, and the annotation message when there is one
 * @returns the annotation object's sha, or undefined for a lightweight tag; the caller confirms by read-back
 */
export function createTagVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { tag: string; sha: string; message: string | undefined };
}): ResultAsync<string | undefined, IngestError> {
  const { owner, repo, tag, sha, message } = input;
  return safeProviderCall({
    execute: async () => {
      if (message === undefined) {
        const created = await ctx.client.rest.git.createRef({ owner, ref: `refs/tags/${tag}`, repo, sha });
        assertCreated({ status: created.status, what: `the tag ref write for ${tag}` });
        return undefined;
      }
      // Two writes, not a transaction: an annotation object with no ref is harmless but must be named.
      let annotated: Awaited<ReturnType<typeof ctx.client.rest.git.createTag>>;
      try {
        annotated = await ctx.client.rest.git.createTag({ message, object: sha, owner, repo, tag, type: "commit" });
        assertCreated({ status: annotated.status, what: `the annotation-object write for ${tag}` });
      } catch (error: unknown) {
        const why = error instanceof Error ? error.message : "unknown failure";
        throw new Error(
          `the annotation-object write failed, or its answer was lost, so an unreachable annotation object for ${tag} may exist; no tag ref was written: ${why}`,
          { cause: error },
        );
      }
      try {
        const created = await ctx.client.rest.git.createRef({
          owner,
          ref: `refs/tags/${tag}`,
          repo,
          sha: annotated.data.sha,
        });
        assertCreated({ status: created.status, what: `the tag ref write for ${tag}` });
      } catch (error: unknown) {
        const why = error instanceof Error ? error.message : "unknown failure";
        throw new Error(
          `annotation object ${annotated.data.sha} was created; the tag ref write then failed, or its answer was lost: ${why}`,
          {
            cause: error,
          },
        );
      }
      return annotated.data.sha;
    },
    operation: "github.git.createRef",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/** The all-zero object id: as a `beforeOid` it asserts a ref does not exist, as an `afterOid` it deletes one. */
const ZERO_OID = "0".repeat(40);

const UPDATE_REFS_MUTATION = `mutation SlopweaverDeleteBranch($input: UpdateRefsInput!) {
  updateRefs(input: $input) { clientMutationId }
}`;

/**
 * Delete a branch ONLY if it is still at `tip`, and keep a tag at `tip` in the SAME update — one GraphQL
 * `updateRefs` call, which GitHub applies atomically: every ref update lands or none does. `createTag` makes
 * the keep-tag there only if it is still absent; `holdTag` names one that already exists, and is sent as a
 * no-op update (`beforeOid` and `afterOid` both its ref oid) so a tag removed or moved after the last read
 * makes GitHub reject the whole update rather than delete the branch with no recovery point.
 *
 * This is why the delete is not REST's `git.deleteRef`: that call takes no expected sha, so a push landing
 * between the last read and the DELETE was deleted with the branch, and a tag made in a separate call before a
 * refusal stayed behind. Here `beforeOid` is the compare-and-swap GitHub checks under its own lock. Sent once.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository, the branch, the tip it must still be at, and the keep-tag to create or hold
 * @returns nothing on success; the caller confirms by read-back
 */
export function deleteBranchAtTipVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { branch: string; tip: string; createTag: string | undefined; holdTag: string | undefined };
}): ResultAsync<void, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const repo = await ctx.client.rest.repos.get({ owner: input.owner, repo: input.repo });
      const refUpdates: { afterOid: string; beforeOid: string; name: string }[] = [];
      if (input.createTag !== undefined) {
        refUpdates.push({ afterOid: input.tip, beforeOid: ZERO_OID, name: `refs/tags/${input.createTag}` });
      }
      if (input.holdTag !== undefined) {
        const { owner, repo: name, holdTag } = input;
        const held = await peelTagRef({
          readRef: async () =>
            (await ctx.client.rest.git.getRef({ owner, ref: `tags/${holdTag}`, repo: name })).data.object,
          readTag: async (tagSha) =>
            (await ctx.client.rest.git.getTag({ owner, repo: name, tag_sha: tagSha })).data.object,
          tag: holdTag,
        });
        if (held === undefined || held.commit !== input.tip) {
          const now = held === undefined ? "is absent" : `peels to ${held.commit}`;
          throw new Error(`tag ${input.holdTag} ${now}, not ${input.tip}; nothing was written`);
        }
        refUpdates.push({ afterOid: held.refOid, beforeOid: held.refOid, name: `refs/tags/${input.holdTag}` });
      }
      refUpdates.push({ afterOid: ZERO_OID, beforeOid: input.tip, name: `refs/heads/${input.branch}` });
      const answer: unknown = await ctx.client.graphql(UPDATE_REFS_MUTATION, {
        input: { refUpdates, repositoryId: repo.data.node_id },
      });
      // Only an answer carrying the mutation's own payload is an applied update; anything else is not assumed.
      if (!(answer instanceof Object) || !("updateRefs" in answer) || answer.updateRefs == null) {
        throw new Error("GitHub's answer to updateRefs carried no updateRefs payload; nothing is assumed written");
      }
    },
    operation: "github.graphql.updateRefs",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
