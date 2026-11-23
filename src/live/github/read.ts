/**
 * A current, single-object GitHub read through the same Octokit and provider door as corpus ingestion.
 *
 * `readGithubObject` returns the selected node RAW — it validates no field, typed or otherwise, for any
 * object kind, bar one: a `/pull/N` address answered by an `Issue` node is refused (`selectedNode`). The `stack`/`stackEntry` fields added here follow that same contract: they flow through
 * untouched in `.data.stack`, exactly like every other field. Stack mutation verbs use GitHub's REST stack
 * surface and the parser under `src/corpus/github/stack.ts`; this general-purpose read does not reinterpret
 * its GraphQL payload as that separate contract.
 *
 * ## Code owners
 *
 * A pull request's `reviewRequests` carry GitHub's own `asCodeOwner` boolean, and each review carries the
 * teams it was submitted `onBehalfOf`. MEASURED on the commit that added them: this query selected **no**
 * `reviewRequests` at all, so the most-used PR read threw the authoritative code-owner answer away and every
 * consumer went back to the CODEOWNERS file and reverse-engineered it. Dropping the authoritative
 * answer is for no good reason.
 * They are selected raw, like everything else here; `src/review/githubCodeowners.ts` is where they are read,
 * and states what GitHub's flags cannot cover.
 */

import { githubScopeId, makeGithubClient } from "../../corpus/github/githubClient.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { collectPaginationResidue, type ProviderReadDocument, type ProviderReadTarget } from "../providerRead.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import {
  type GithubGraphqlRequestOptions,
  githubReadFailure,
  graphqlCallOptions,
  withMissingFilesAsNull,
} from "./graphqlRequest.js";
import { DISCUSSION_QUERY, ISSUE_OR_PULL_REQUEST_QUERY } from "./readQueries.js";

type GithubObjectKind = "issue" | "pull-request" | "discussion";

interface GithubAddress extends ProviderReadTarget {
  readonly kind: GithubObjectKind;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * The injected GraphQL seam. Production wraps Octokit in `safeProviderCall`; tests supply a plain fake.
 * `request` is a per-call transport override, absent for all but the fleet read (`./graphqlRequest.ts`).
 * `missingFileReadsNull` answers the partial data of a read whose only errors are paths a commit does not hold, those
 * paths `null`, for the one caller that asks whether a path exists (`./diffOnBase.ts`).
 */
export type GithubReadGraphql = (args: {
  query: string;
  variables: Readonly<Record<string, unknown>>;
  request?: GithubGraphqlRequestOptions;
  missingFileReadsNull?: true;
}) => Promise<Result<unknown, GithubLiveError>>;

/**
 * The injected REST seam, for the reads GraphQL cannot answer. Same shape and same door as the GraphQL one;
 * production wraps Octokit in `safeProviderCall`, tests supply a plain fake.
 *
 * It exists because a repository governed by a RULESET rather than classic branch protection reports
 * `Ref.branchProtectionRule` as null, so the effective rules on a branch are unreachable over GraphQL.
 */
export type GithubReadRest = (args: {
  route: string;
  params: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, GithubLiveError>>;

/**
 * Parse a GitHub issue, pull-request or discussion URL without resolving a token.
 *
 * @param address the user-supplied URL
 * @returns the typed object address, or an actionable refusal
 */
export function parseGithubReadAddress({ address }: { address: string }): Result<GithubAddress, GithubLiveError> {
  const matches = [
    ...address.matchAll(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull|discussions)\/\d+/giu),
  ].map((match) => match[0]);
  const candidates = [...new Set(matches)];
  if (candidates.length > 1) {
    return err(
      GithubLiveErrors.ambiguousAddress({
        message: "GitHub read needs exactly one object link; the question contains more than one",
      }),
    );
  }
  // No object link in the text means the address itself is the URL to read; one link is that object's own.
  const candidate = candidates.length === 0 ? address : candidates[0]!;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return err(
      GithubLiveErrors.invalidAddress({
        message: "GitHub read needs a full https://github.com/owner/repo/issues|pull|discussions/number URL",
      }),
    );
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    return err(
      GithubLiveErrors.invalidAddress({
        message: `GitHub read accepts only https://github.com links, got ${candidate}`,
      }),
    );
  }
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const [owner, repo, family, rawNumber] = parts;
  const familyToKind: Readonly<Record<string, GithubObjectKind>> = {
    discussions: "discussion",
    issues: "issue",
    pull: "pull-request",
  };
  const kind = family === undefined ? undefined : familyToKind[family];
  const number = rawNumber === undefined ? Number.NaN : Number(rawNumber);
  if (
    owner === undefined ||
    repo === undefined ||
    parts.length !== 4 ||
    kind === undefined ||
    !Number.isInteger(number) ||
    number <= 0
  ) {
    return err(
      GithubLiveErrors.invalidAddress({
        message: "expected https://github.com/owner/repo/issues/<number>, /pull/<number> or /discussions/<number>",
      }),
    );
  }
  return ok({ address: candidate, identity: `${owner}/${repo}#${String(number)}`, kind, number, owner, repo });
}

/**
 * What this read established, per object kind.
 *
 * A pull request names its code-owner fields explicitly rather than leaving a reader to notice
 * `asCodeOwner` in the payload: the whole point of carrying them is that nobody has to go looking.
 */
function coverageDetail({ kind, limit }: { kind: GithubObjectKind; limit: number }): string {
  const base = `one named object, with up to ${String(limit)} items from each selected activity connection`;
  if (kind !== "pull-request") {
    return base;
  }
  return (
    `${base}; code owners are GitHub's own — \`reviewRequests[].asCodeOwner\` for the ones it is still ` +
    "waiting on, and `reviews[].onBehalfOf` for the teams an approval already satisfied — never a reading " +
    "of the CODEOWNERS file"
  );
}

/**
 * Return the selected node, refusing a successful GraphQL response whose object is absent, and a pull-request
 * address GitHub answered with an `Issue`.
 *
 * `issueOrPullRequest` resolves EITHER kind at a number, so a `/pull/<number>` where the number is an issue came back as that
 * issue's state and title under `target.kind: "pull-request"` — a probe could "prove" a pull request open that
 * never existed. MEASURED on an open issue: `slopweaver github read
 * https://github.com/<owner>/<repo>/pull/<issue-number> --json` printed `"__typename": "Issue"`, `"state": "OPEN"`.
 * The reverse is left alone: GitHub's own web redirects `/issues/N` to `/pull/N`, and a pull request is an issue
 * in its model, so a caller reading "whichever kind holds N" addresses it by `/issues/N`. Only an explicit
 * `Issue` refuses; the query always selects `__typename`.
 */
function selectedNode({ data, target }: { data: unknown; target: GithubAddress }): Result<unknown, GithubLiveError> {
  const { identity, kind } = target;
  const repository = isRecord(data) && isRecord(data["repository"]) ? data["repository"] : undefined;
  const key = kind === "discussion" ? "discussion" : "issueOrPullRequest";
  const node = repository?.[key];
  if (node === null || node === undefined) {
    return err(GithubLiveErrors.notFound({ identity, kind }));
  }
  if (kind === "pull-request" && isRecord(node) && node["__typename"] === "Issue") {
    const issueUrl = `https://github.com/${target.owner}/${target.repo}/issues/${String(target.number)}`;
    return err(GithubLiveErrors.notAPullRequest({ identity, issueUrl }));
  }
  return ok(node);
}

/**
 * Read one current GitHub object.
 *
 * @param address the full GitHub object URL
 * @param graphql the safe-wrapped GraphQL seam
 * @param limit the maximum items requested from each selected connection
 * @param nowIso the freshness clock
 * @returns a bounded provider document, or a named read failure
 */
export async function readGithubObject({
  address,
  graphql,
  limit,
  nowIso,
}: {
  address: string;
  graphql: GithubReadGraphql;
  limit: number;
  nowIso: () => string;
}): Promise<Result<ProviderReadDocument, GithubLiveError>> {
  const parsed = parseGithubReadAddress({ address });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const target = parsed.value;
  const response = await graphql({
    query: target.kind === "discussion" ? DISCUSSION_QUERY : ISSUE_OR_PULL_REQUEST_QUERY,
    variables: { limit, number: target.number, owner: target.owner, repo: target.repo },
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const selected = selectedNode({ data: response.value, target });
  if (selected.isErr()) {
    return err(selected.error);
  }
  const residue: string[] = [];
  collectPaginationResidue({ out: residue, path: "data", value: selected.value });
  residue.unshift("only fields declared by the typed live-reader query were requested");
  return ok({
    coverage: {
      detail: coverageDetail({ kind: target.kind, limit }),
      kind: "bounded",
      residue,
    },
    data: selected.value,
    readAtIso: nowIso(),
    source: "github",
    target,
  });
}

/**
 * Build the production REST seam over the same resilient Octokit client and provider door.
 *
 * @param token the GitHub token, or undefined for public unauthenticated reads
 * @returns a safe result-returning REST seam
 */
export function githubReadRest({ token }: { token: string | undefined }): GithubReadRest {
  const client = makeGithubClient({ token });
  const scopeId = githubScopeId({ token });
  return async ({ route, params }) => {
    const called = await safeProviderCall({
      execute: () => client.request(route, params),
      operation: "github.rest.namedObjectRead",
      provider: "github",
      retryMode: "never",
      scopeId,
    });
    return called.isErr() ? err(githubReadFailure({ failure: called.error })) : ok(called.value);
  };
}

/**
 * Build the production GraphQL seam over the repository's resilient Octokit client and provider door.
 *
 * @param token the GitHub token, or undefined for public unauthenticated reads
 * @returns a safe result-returning GraphQL seam
 */
export function githubReadGraphql({ token }: { token: string | undefined }): GithubReadGraphql {
  const client = makeGithubClient({ token });
  const scopeId = githubScopeId({ token });
  return async ({ query, variables, request, missingFileReadsNull }) => {
    const options = graphqlCallOptions({ request, scopeId, variables });
    if (options.isErr()) {
      return err(options.error);
    }
    const called = await safeProviderCall({
      execute: () =>
        withMissingFilesAsNull({ execute: () => client.graphql(query, options.value), missingFileReadsNull }),
      operation: "github.graphql.namedObjectRead",
      provider: "github",
      retryMode: "never",
      scopeId,
    });
    return called.isErr() ? err(githubReadFailure({ failure: called.error })) : ok(called.value);
  };
}
