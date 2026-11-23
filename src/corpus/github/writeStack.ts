/**
 * Native GitHub stack operations for the write lane — split out of `./write.ts` (file-size ratchet).
 * Everything here is a plain move: same bodies, same JSDoc, same `safeProviderCall` posture per operation.
 */
import { type IngestError, ingestErrorToThrowable } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import { type GithubStack, toGithubStack, toGithubStackOrDissolved } from "./stack.js";
import type { RepoRef, WriteCtx, WrittenPr } from "./write.js";
import { toWrittenPr } from "./writeCrud.js";

/**
 * Create a native GitHub stack. `retryMode: "never"` — this is an irreversible create, same posture as
 * `createVia`. No generated Octokit type exists for this endpoint yet, so `client.request` is the sanctioned
 * escape hatch (`boundaryResidue`'s `octokit-call` token covers it) rather than a typed convenience method.
 *
 * @returns the created stack, or the provider failure
 */
export function createStackVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly pullRequests: readonly [number, number, ...number[]] };
}): ResultAsync<GithubStack, IngestError> {
  const { owner, repo, pullRequests } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.request("POST /repos/{owner}/{repo}/stacks", {
        owner,
        pull_requests: [...pullRequests],
        repo,
      });
      return toGithubStack({ value: res.data });
    },
    operation: "github.stacks.create",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Extend an existing native stack. `retryMode: "never"` for the same reason as {@link createStackVia}.
 *
 * @returns the extended stack, or the provider failure
 */
export function addToStackVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly stackNumber: number; readonly pullRequests: readonly [number, ...number[]] };
}): ResultAsync<GithubStack, IngestError> {
  const { owner, repo, stackNumber, pullRequests } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.request("POST /repos/{owner}/{repo}/stacks/{stack_number}/add", {
        owner,
        pull_requests: [...pullRequests],
        repo,
        stack_number: stackNumber,
      });
      return toGithubStack({ value: res.data });
    },
    operation: "github.stacks.add",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Remove every unmerged pull request from a native stack — GitHub's only native removal endpoint. There is
 * no way to name which entries to remove: a locked or already-merged entry is left in place, per GitHub's
 * own documented behaviour, and everything else goes. `retryMode: "never"` for the same reason as
 * {@link createStackVia} — this is an irreversible mutation.
 *
 * @returns the surviving stack when an entry could not be unstacked, `undefined` once the stack is fully
 *   dissolved, or the provider failure
 */
export function unstackVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly stackNumber: number };
}): ResultAsync<GithubStack | undefined, IngestError> {
  const { owner, repo, stackNumber } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.request("POST /repos/{owner}/{repo}/stacks/{stack_number}/unstack", {
        owner,
        repo,
        stack_number: stackNumber,
      });
      return toGithubStackOrDissolved({ value: res.data });
    },
    operation: "github.stacks.unstack",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read one native stack's full ordered entries.
 *
 * @returns the stack, or the provider failure
 */
export function getStackVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly stackNumber: number };
}): ResultAsync<GithubStack, IngestError> {
  const { owner, repo, stackNumber } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.request("GET /repos/{owner}/{repo}/stacks/{stack_number}", {
        owner,
        repo,
        stack_number: stackNumber,
      });
      return toGithubStack({ value: res.data });
    },
    operation: "github.stacks.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/** How many pages the open-pull-request pagers fetch before stopping — a sane ceiling, never unbounded. */
const AUTHORED_PRS_MAX_PAGES = 5;
const AUTHORED_PRS_PAGE_SIZE = 100;

/**
 * Every open pull request in one repository, whoever authored it, plus the viewer's own immutable id so a
 * caller can tell which of them are its own without a second round trip.
 *
 * Repo-wide rather than author-scoped because the chained-not-stacked class is a RELATION between two pull
 * requests: a branch of the operator's can be chained onto someone else's open pull request, and an audit
 * that only ever saw the operator's own would report that pair as clean. `pulls.list` has no author filter
 * anyway, so {@link listOpenPrsAuthoredByMeVia} is a client-side filter over exactly this walk rather than a
 * second, cheaper call.
 *
 * The `stack` field rides this payload. MEASURED against acme/acme-admin: `pulls.list` at
 * `per_page: 100` returned 391 open pull requests, 43 of them carrying a populated `stack` object, and
 * one such pull request's read back `{"id":929317,"number":16958,"size":3,"position":1}` — byte-identical membership to what
 * `getPr` reports for it. So an audit over every open pull request costs four list calls rather than 391
 * `getPr` reads, and a caller must NOT re-read each candidate to learn its membership. Reproduce with
 * `slopweaver github stack audit --repo acme/acme-admin --json` and compare one entry against
 * `slopweaver github read <its url> --json`.
 *
 * Capped at {@link AUTHORED_PRS_MAX_PAGES} pages (500 open pull requests) rather than left unbounded, and
 * **the cap is REPORTED rather than silently applied**. The interface doc claimed truncation was reported
 * from the day this was written while the return type carried no such field, so every caller read a capped
 * list as a complete one — and `github stack restack`, whose whole claim is "every open pull request you
 * authored", would have restacked the first 500 and said nothing. MEASURED, acme-admin returned
 * 391 open pull requests, one page short of the cap. The walk asks for one page BEYOND the bound to decide
 * this, so exactly 500 open pull requests reads as complete rather than as truncated.
 *
 * @returns every open pull request, the viewer's id, and whether the cap cut the walk short
 */
export function listOpenPrsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<
  { readonly prs: readonly WrittenPr[]; readonly viewerId: number | undefined; readonly truncated: boolean },
  IngestError
> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      // NOT fatal, and deliberately so: GitHub Actions' own `GITHUB_TOKEN` is an installation token with no
      // user behind it, and `users.getAuthenticated` answers 403 for one. The viewer id only decides which
      // violations are labelled "yours", so a CI lane that cannot read it still gets the whole audit —
      // whereas letting the read fail would make the gate unrunnable in the lane it most needs to run in.
      const viewerId = await ctx.client.rest.users
        .getAuthenticated()
        .then((viewer): number | undefined => viewer.data.id)
        .catch((): undefined => undefined);
      const prs: WrittenPr[] = [];
      let truncated = false;
      for (let page = 1; page <= AUTHORED_PRS_MAX_PAGES + 1; page += 1) {
        const res = await ctx.client.rest.pulls.list({
          owner,
          page,
          per_page: AUTHORED_PRS_PAGE_SIZE,
          repo,
          state: "open",
        });
        // The sentinel page past the bound decides truncation and is never collected: a repository with
        // exactly 500 open pull requests answers it empty, and reads as complete rather than as cut short.
        if (page > AUTHORED_PRS_MAX_PAGES) {
          truncated = res.data.length > 0;
          break;
        }
        for (const raw of res.data) {
          prs.push(toWrittenPr({ data: raw }));
        }
        if (res.data.length < AUTHORED_PRS_PAGE_SIZE) {
          break;
        }
      }
      return { prs, truncated, viewerId };
    },
    operation: "github.pulls.list",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Every open pull request this token's account authored, in one repository — {@link listOpenPrsVia} filtered
 * client-side against the viewer's own immutable id, since `pulls.list` has no author-id filter.
 *
 * An unknown viewer is a FAILURE here rather than an empty answer: this reader is defined by "mine", and
 * `pr.authorId === viewerId` would otherwise quietly match every pull request GitHub reported no user for.
 *
 * @returns the viewer's own open pull requests and whether the walk was cut short, or the provider failure
 */
export function listOpenPrsAuthoredByMeVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<{ readonly prs: readonly WrittenPr[]; readonly truncated: boolean }, IngestError> {
  return safeProviderCall({
    execute: async () => {
      const listed = await listOpenPrsVia({ ctx, input });
      if (listed.isErr()) {
        throw ingestErrorToThrowable({ error: listed.error });
      }
      const { prs, truncated, viewerId } = listed.value;
      if (viewerId === undefined) {
        throw new Error("could not read the authenticated user, so 'authored by me' cannot be decided");
      }
      // Truncation rides the FILTERED answer unchanged: the cap applies to the repository-wide walk, so a
      // caller that ends up with three of its own pull requests still cannot claim it saw all of them.
      return { prs: prs.filter((pr) => pr.authorId === viewerId), truncated };
    },
    operation: "github.pulls.list",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}
