/**
 * Pull-request CRUD operations for the GitHub write lane — split out of `./write.ts` (file-size ratchet).
 * Everything here is a plain move: same bodies, same JSDoc, same `safeProviderCall` posture per operation.
 */
import type { RestEndpointMethodTypes } from "@octokit/rest";

import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { PrRef, PrStackMembership, RepoRef, WorkflowRun, WriteCtx, WrittenPr } from "./write.js";

/**
 * A `fetch` that refuses to follow a redirect.
 *
 * A 307 preserves the method and body, so following one re-sends the POST — measured as two creates against
 * a local server. `redirect: "manual"` turns it into a response the SDK reports as an error, which is the
 * right outcome for an irreversible write: better a visible failure than a silent second pull request. It
 * delegates exactly once and adds no retry or backoff of its own.
 *
 * @param input the request URL or Request
 * @param init the request options
 * @returns the response, with redirects unfollowed
 */
// named-object-params-exempt: Octokit calls this as the WHATWG fetch(input, init), so the shape is not ours
export async function noRedirectFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, redirect: "manual" });
}

/**
 * GitHub's own pull-request payload type, taken from Octokit's generated definitions rather than restated.
 *
 * An earlier cut declared this structurally by hand. That was redundant at best and drift-prone at worst:
 * a hand-written mirror merely HAPPENS to match, so a field Octokit renames goes unnoticed until runtime.
 * Naming the generated type makes the compiler check the real contract at every call site.
 *
 * `pulls.create`, `pulls.get` and `pulls.update` all answer with this same shape — verified mutually
 * assignable — so one alias covers all three.
 */
type RawPr = RestEndpointMethodTypes["pulls"]["create"]["response"]["data"];

/**
 * The narrower shape `pulls.list` answers with.
 *
 * A list item is NOT a detail payload — it omits `merged`, `mergeable`, `changed_files` and nine others — so
 * one alias cannot cover both. It does carry every field {@link toWrittenPr} reads, which is why the
 * projection accepts either rather than the list path getting a second projection that could drift.
 */
type RawPrSummary = RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];

/**
 * The author's numeric id, read defensively.
 *
 * Octokit's generated types declare `user` as always present, so an optional chain here reads as unnecessary
 * to the type-aware lint — but a deleted or ghost account really can come back null on the wire, and
 * dereferencing that would throw rather than fail closed. Reading it as `unknown` keeps the runtime honest
 * without asserting a shape the payload does not guarantee.
 */
function authorIdOf({ user }: { user: unknown }): number | undefined {
  if (!isRecord(user)) {
    return undefined;
  }
  const id = user["id"];
  return typeof id === "number" ? id : undefined;
}

/**
 * A head repository's full name, read defensively for the same reason as {@link authorIdOf}.
 *
 * GitHub reports `head.repo` as NULL once the fork a pull request came from is deleted. The generated types do
 * not admit that, so the type-aware lint calls a guard unnecessary — but the state is real and it is the one
 * this lane must keep distinct: coalescing it to the base repository would let a deleted-fork pull request
 * answer a plain same-repository branch address.
 */
function repoFullNameOf({ repo }: { repo: unknown }): string | undefined {
  if (!isRecord(repo)) {
    return undefined;
  }
  const name = repo["full_name"];
  return typeof name === "string" ? name : undefined;
}

/**
 * A pull request's inline `stack` field, read defensively — no generated Octokit type declares it yet, so
 * it cannot be read off `RawPr`/`RawPrSummary` directly the way every other field here is.
 */
function stackMembershipOf({ data }: { data: unknown }): PrStackMembership | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const stack = data["stack"];
  if (!isRecord(stack)) {
    return undefined;
  }
  const { id, number, size, position } = stack;
  if (
    typeof id !== "number" ||
    typeof number !== "number" ||
    typeof size !== "number" ||
    typeof position !== "number"
  ) {
    return undefined;
  }
  return { id, number, position, size };
}

/**
 * Narrow GitHub's pull-request payload to {@link WrittenPr}.
 *
 * @returns the projected pull request
 */
export function toWrittenPr({ data }: { data: RawPr | RawPrSummary }): WrittenPr {
  return {
    authorId: authorIdOf({ user: data.user }),
    baseRef: data.base.ref,
    baseRepoFullName: data.base.repo.full_name,
    body: typeof data.body === "string" ? data.body : undefined,
    commits: "commits" in data && typeof data.commits === "number" ? data.commits : undefined,
    draft: data.draft === true,
    head: {
      label: data.head.label,
      ref: data.head.ref,
      repoFullName: repoFullNameOf({ repo: data.head.repo }),
      sha: data.head.sha,
    },
    htmlUrl: data.html_url,
    mergedAtIso: "merged_at" in data && typeof data.merged_at === "string" ? data.merged_at : undefined,
    nodeId: data.node_id,
    number: data.number,
    stack: stackMembershipOf({ data }),
    state: data.state,
    title: data.title,
    updatedAtIso: data.updated_at,
  };
}

/**
 * Open a pull request. `retryMode: "never"` — this is the irreversible one.
 *
 * @returns the created pull request, or the provider failure
 */
export function createVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { base: string; head: string; title: string; body: string; draft: boolean };
}): ResultAsync<WrittenPr, IngestError> {
  return safeProviderCall({
    execute: async () => {
      // Fields named explicitly rather than spreading `input`. Passing the caller's object through would
      // forward anything else it happened to carry straight to the API, and a readonly type does not
      // satisfy Octokit's indexed `RequestParameters` anyway — the compiler says so.
      const { owner, repo, base, head, title, body, draft } = input;
      const res = await ctx.client.rest.pulls.create({ base, body, draft, head, owner, repo, title });
      return toWrittenPr({ data: res.data });
    },
    operation: "github.pulls.create",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Re-render an existing pull request's description, title and/or base branch.
 *
 * `base` is the same field `github pr retarget` sends to move a pull request onto a different base — the
 * one step of building a native GitHub stack no other verb covered until that write shipped. GitHub itself
 * validates the target ref and answers 422 when it does not exist, which the caller surfaces rather than
 * this lane pre-checking it.
 *
 * @returns the updated pull request, or the provider failure
 */
export function updateVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & { title?: string | undefined; body?: string | undefined; base?: string | undefined };
}): ResultAsync<WrittenPr, IngestError> {
  const { owner, repo, number, title, body, base } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.update({
        owner,
        pull_number: number,
        repo,
        ...(title === undefined ? {} : { title }),
        ...(body === undefined ? {} : { body }),
        ...(base === undefined ? {} : { base }),
      });
      return toWrittenPr({ data: res.data });
    },
    operation: "github.pulls.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read a pull request back. Repeatable, so transient retries are allowed.
 *
 * @returns the pull request, or the provider failure
 */
export function getVia({ ctx, input }: { ctx: WriteCtx; input: PrRef }): ResultAsync<WrittenPr, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.get({ owner, pull_number: number, repo });
      return toWrittenPr({ data: res.data });
    },
    operation: "github.pulls.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Mark one draft pull request ready. The mutation is sent once and confirmed by the command's next read.
 *
 * @returns nothing, or the provider failure
 */
export function markReadyVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { nodeId: string };
}): ResultAsync<void, IngestError> {
  return safeProviderCall({
    execute: async () => {
      await ctx.client.graphql(
        `mutation SlopweaverMarkPullRequestReady($pullRequestId: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
            pullRequest { id isDraft }
          }
        }`,
        { pullRequestId: input.nodeId },
      );
    },
    operation: "github.markPullRequestReadyForReview",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Return one pull request to draft — the exact inverse of {@link markReadyVia}, sent once and confirmed by
 * the command's next read.
 *
 * A separate GraphQL mutation rather than a flag on the ready one, because that is how GitHub models it:
 * REST's `PATCH /pulls/{n}` silently ignores a `draft` field, so the only honest transition in either
 * direction is its own named mutation.
 *
 * @returns nothing, or the provider failure
 */
export function markDraftVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { nodeId: string };
}): ResultAsync<void, IngestError> {
  return safeProviderCall({
    execute: async () => {
      await ctx.client.graphql(
        `mutation SlopweaverConvertPullRequestToDraft($pullRequestId: ID!) {
          convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
            pullRequest { id isDraft }
          }
        }`,
        { pullRequestId: input.nodeId },
      );
    },
    operation: "github.convertPullRequestToDraft",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Pull requests on one base and head pair.
 *
 * `state: "all"` because the question is whether the address is UNIQUE, and a merged pull request occupying
 * the same branch pair is precisely what makes it ambiguous. `per_page: 2` is the whole page needed: one match
 * resolves, two is already a refusal, so fetching more would be paging for an answer that cannot change.
 *
 * @returns the matching pull requests, or the provider failure
 */
export function listPrsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { base: string; head: string };
}): ResultAsync<readonly WrittenPr[], IngestError> {
  const { owner, repo, base, head } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.list({ base, head, owner, per_page: 2, repo, state: "all" });
      return res.data.map((data) => toWrittenPr({ data }));
    },
    operation: "github.pulls.list",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * The single open pull request whose head is this branch, if any. `head` wants `owner:ref`.
 *
 * @returns the matching pull request, `undefined` when none matches, or the provider failure
 */
export function findOpenPrByHeadVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { head: string };
}): ResultAsync<WrittenPr | undefined, IngestError> {
  const { owner, repo, head } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.list({
        head: `${owner}:${head}`,
        owner,
        per_page: 1,
        repo,
        state: "open",
      });
      return res.data[0] === undefined ? undefined : toWrittenPr({ data: res.data[0] });
    },
    operation: "github.pulls.list",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Whether the viewer can push.
 *
 * Reports the VIEWER's repository role, which is the strongest signal a read-only probe can give. It is NOT
 * an attestation that a fine-grained token holds `Pull requests: write`, and the caller's refusal message
 * says so rather than implying a guarantee the API never made.
 *
 * @returns whether the viewer can push, or the provider failure
 */
export function canPushVia({ ctx, input }: { ctx: WriteCtx; input: RepoRef }): ResultAsync<boolean, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.repos.get({ owner: input.owner, repo: input.repo });
      return res.data.permissions?.push === true;
    },
    operation: "github.repos.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * The branch's `pull_request` Actions runs, for resolving the CI badge's link.
 *
 * @returns the workflow runs, or the provider failure
 */
export function listRunsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { branch: string };
}): ResultAsync<readonly WorkflowRun[], IngestError> {
  const { owner, repo, branch } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.actions.listWorkflowRunsForRepo({
        branch,
        event: "pull_request",
        owner,
        per_page: 100,
        repo,
      });
      return res.data.workflow_runs.map((run) => ({ createdAt: run.created_at, htmlUrl: run.html_url, id: run.id }));
    },
    operation: "github.actions.listWorkflowRunsForRepo",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Close a pull request without merging — `github close`'s mutation, and the recorded test's cleanup, since
 * GitHub cannot delete one.
 *
 * @returns the closed pull request, or the provider failure
 */
export function closeVia({ ctx, input }: { ctx: WriteCtx; input: PrRef }): ResultAsync<WrittenPr, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.update({ owner, pull_number: number, repo, state: "closed" });
      return toWrittenPr({ data: res.data });
    },
    operation: "github.pulls.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Who the token belongs to.
 *
 * Repeatable, so transient retries are allowed. A failure is returned rather than coerced: the documented
 * failure states include 401 and 403, and an installation token is not among the credentials this endpoint
 * serves, so "could not tell" has to reach the caller intact.
 *
 * @returns the authenticated user's numeric id, or the provider failure
 */
export function authenticatedUserIdVia({ ctx }: { ctx: WriteCtx }): ResultAsync<number, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.users.getAuthenticated();
      return res.data.id;
    },
    operation: "github.users.getAuthenticated",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}
