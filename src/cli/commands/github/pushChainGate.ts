/**
 * `github push`'s chained-not-natively-stacked gate — the door that catches a chain nobody opened through
 * `stack push`.
 *
 * The creation door already registers a native stack for every pull request it opens, and `pr retarget`
 * refuses to point one at another open pull request's branch without adopting in the same breath. This is the
 * third door because a pull request can arrive in that state without either of them: opened before the doors
 * existed, opened by a human in the web UI, or opened by a session that routed around the verbs. A push to
 * such a branch is the next thing that happens to it, so refusing there is what makes the state impossible to
 * KEEP rather than merely impossible to create.
 *
 * Two reads, not a repository-wide listing: the branch's own open pull request, then — only when its base is
 * not the repository default — the open pull request whose head that base is. Both are `pulls.list` filtered
 * by `owner:branch`, so an ordinary push of an unchained branch costs one cheap call and stops.
 *
 * ## Failing closed, and where it stops
 *
 * A missing token or an unreadable pull request REFUSES, matching `./stackCarryRun.ts`'s own posture in its
 * own words: "a gate that silently passes because it could not see is the failure this whole mechanism exists
 * to remove". What does NOT refuse is a driver with no `stackCarry` edge at all, which is a caller that has no
 * GitHub surface to read through — the same exemption the carry gate takes, and the shipped verb always
 * supplies the edge.
 */
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { type GithubPushDeps, ownerRepoOf } from "./pushPrimitives.js";
import { auditPrOf, chainDoorRefusalLines, chainKindFor } from "./stackAuditCore.js";

/** What the two reads found: nothing to refuse, an unreadable pull request, or a chain with no native stack. */
type ChainedPair =
  | { readonly kind: "clear" }
  | { readonly kind: "refused" }
  | { readonly kind: "chained"; readonly child: WrittenPr; readonly parent: WrittenPr };

/**
 * The branch's own open pull request and the one its base belongs to, when that pair is a chain GitHub does
 * not know about.
 *
 * Split from {@link pushChainGateRefused} to keep that function inside the length gate; it is also the whole
 * of the reading, so the caller holds nothing but the token check and the refusal text.
 *
 * @param api the GitHub write surface
 * @param branch the branch being pushed
 * @param defaultBranch the repository's default branch — a pull request based on it is never a chain
 * @param out where an unreadable pull request is reported
 * @param repo the `owner/name` slug being pushed to
 * @returns the chained pair, or that there is nothing to refuse (or that the read itself failed)
 */
async function chainedPair({
  api,
  branch,
  defaultBranch,
  out,
  repo,
}: {
  api: GithubWriteApi;
  branch: string;
  defaultBranch: string;
  out: (args: { line: string }) => void;
  repo: string;
}): Promise<ChainedPair> {
  const { owner, repo: name } = ownerRepoOf({ slug: repo });
  const own = await api.findOpenPrByHead({ head: branch, owner, repo: name });
  if (own.isErr()) {
    out({ line: `refused: could not read the open pull request for ${branch}: ${own.error.message}` });
    return { kind: "refused" };
  }
  if (own.value === undefined || own.value.baseRef === defaultBranch) {
    return { kind: "clear" };
  }
  const parent = await api.findOpenPrByHead({ head: own.value.baseRef, owner, repo: name });
  if (parent.isErr()) {
    out({
      line: `refused: could not read the open pull request for base branch ${own.value.baseRef}: ${parent.error.message}`,
    });
    return { kind: "refused" };
  }
  if (parent.value === undefined) {
    return { kind: "clear" };
  }
  const kind = chainKindFor({
    childStackNumber: own.value.stack?.number,
    parentStackNumber: parent.value.stack?.number,
  });
  return kind === undefined ? { kind: "clear" } : { child: own.value, kind: "chained", parent: parent.value };
}

/**
 * Whether this push must be refused because the branch's pull request is chained onto another open pull
 * request without a native GitHub stack.
 *
 * @param branch the branch being pushed
 * @param defaultBranch the repository's default branch — a pull request based on it is never a chain
 * @param deps the push edges, whose optional `stackCarry` bundle carries the API factory and token resolver
 * @param home the state home the token is resolved from
 * @param repo the `owner/name` slug being pushed to
 * @returns whether the caller must refuse and send nothing
 */
export async function pushChainGateRefused({
  branch,
  defaultBranch,
  deps,
  home,
  repo,
}: {
  branch: string;
  defaultBranch: string;
  deps: GithubPushDeps;
  home: string;
  repo: string;
}): Promise<boolean> {
  const carry = deps.stackCarry;
  if (carry === undefined) {
    return false;
  }
  const { out } = deps;
  const token = carry.token({ home });
  if (token === undefined) {
    out({
      line:
        "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token), so " +
        `whether ${branch}'s pull request is chained onto another open one cannot be read — refusing rather ` +
        "than pushing blind",
    });
    return true;
  }
  const pair = await chainedPair({ api: carry.makeApi({ home, token }), branch, defaultBranch, out, repo });
  if (pair.kind !== "chained") {
    return pair.kind === "refused";
  }
  for (const line of chainDoorRefusalLines({
    base: pair.child.baseRef,
    parent: auditPrOf({ pr: pair.parent, viewerId: undefined }),
    verb: `pushing ${branch}, whose open pull request #${String(pair.child.number)} is based on ${pair.child.baseRef}`,
  })) {
    out({ line });
  }
  return true;
}
