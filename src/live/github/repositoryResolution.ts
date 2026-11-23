/**
 * Whether GitHub resolves one `owner/name` at all — the one fact a `search` cannot tell a caller.
 *
 * MEASURED: `slopweaver github bump-drive --repo <an owner/name GitHub cannot resolve> --dry-run`
 * printed "No dependency bumps among the 0 open pull request(s)" and exited 0, because the fleet read is a GraphQL
 * `search(query: "repo:<slug> ...")` and GitHub answers an unresolvable `repo:` qualifier with an EMPTY connection
 * and no `errors` — a wrong slug reads exactly as a repository with nothing open. `./supersedeReads.ts` records
 * the same behaviour for an unresolvable `author:`. `repository(owner:, name:)` does not stay quiet: GitHub fails
 * it with one NOT_FOUND, which `@octokit/graphql` throws and the safe transport hands back as `READ_FAILED`
 * carrying the aggregate message. Reproduce with `slopweaver github landing --repo <that slug> --json`, whose
 * census read is this same `repository` field and prints the exact message as its `unread` reason.
 *
 * So a failure becomes `NOT_FOUND` only on that exact whole message — octokit's header and one bullet naming this
 * very slug — the way `./prBody.ts` recognises an unresolved pull request. A rate limit, any other read failure, or
 * a bullet beside another error stays what it was: none of those is evidence the repository is absent.
 */

import { parseRepositorySlug } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** The smallest read that names a repository: its canonical `owner/name`, nothing else. */
export const REPOSITORY_RESOLUTION_QUERY = `query SlopweaverRepositoryResolution($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) { nameWithOwner }
}`;

/** The first line octokit writes for a GraphQL response that carried errors. */
const AGGREGATE_HEADER = "Request failed due to following response errors:";

/** A repository GitHub resolved, by the name it answers to now (a renamed one answers with its new name). */
export interface ResolvedGithubRepository {
  readonly nameWithOwner: string;
}

/** The HTTP status GitHub answers a GraphQL document with when the document's own errors failed it. */
const GRAPHQL_ERRORS_STATUS = 200;

/**
 * Whether a read failure's cause says the provider never gave a GraphQL answer at all — the transport died, the
 * rate limit refused it, or the response carried a status other than the 200 GitHub sends an errored document
 * with. Such a cause outranks a matching message: only an ANSWER can say a repository is not there.
 *
 * @param cause the read failure's carried cause, an `IngestError` from the safe transport when there is one
 * @returns true when the cause rules out the failure being GitHub's own resolution answer
 */
function causeIsTransient({ cause }: { cause: unknown }): boolean {
  if (!isRecord(cause)) {
    return false;
  }
  if (cause["kind"] === "network" || cause["kind"] === "rate-limit") {
    return true;
  }
  const { status } = cause;
  return typeof status === "number" && status !== GRAPHQL_ERRORS_STATUS;
}

/**
 * Whether a failed read failed ONLY because this slug resolves to nothing: octokit's header, then exactly the one
 * bullet GitHub writes for an unresolvable repository naming this slug, byte for byte.
 *
 * @param error the failed read
 * @param repoSlug the `owner/name` the read sent
 * @returns true when nothing but this slug's resolution failed the read
 */
function onlyUnresolved({ error, repoSlug }: { error: GithubLiveError; repoSlug: string }): boolean {
  if (error.code !== "READ_FAILED" || causeIsTransient({ cause: error.cause })) {
    return false;
  }
  return error.message === `${AGGREGATE_HEADER}\n - Could not resolve to a Repository with the name '${repoSlug}'.`;
}

/**
 * Parse one raw resolution response.
 *
 * @param data the raw GraphQL response
 * @param repoSlug the slug asked for, named by a not-found
 * @returns the resolved repository, NOT_FOUND for an explicit null, else a read failure naming what was missing
 */
function parseRepositoryResolution({
  data,
  repoSlug,
}: {
  data: unknown;
  repoSlug: string;
}): Result<ResolvedGithubRepository, GithubLiveError> {
  if (!isRecord(data) || !("repository" in data)) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub's answer for ${repoSlug} carried no repository field` }));
  }
  const { repository } = data;
  if (repository === null) {
    return err(GithubLiveErrors.notFound({ identity: repoSlug, kind: "repository" }));
  }
  const name = isRecord(repository) ? repository["nameWithOwner"] : undefined;
  if (typeof name !== "string" || name === "") {
    return err(GithubLiveErrors.readFailed({ message: `GitHub's answer for ${repoSlug} carried no nameWithOwner` }));
  }
  return ok({ nameWithOwner: name });
}

/**
 * Ask GitHub whether it resolves one repository.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @param repoSlug `owner/name`, as the caller was given it
 * @returns the resolved repository; NOT_FOUND when GitHub resolves nothing there or the credential cannot see it;
 * else the read's own failure, which proves nothing about the repository
 */
export async function resolveGithubRepository({
  graphql,
  repoSlug,
}: {
  graphql: GithubReadGraphql;
  repoSlug: string;
}): Promise<Result<ResolvedGithubRepository, GithubLiveError>> {
  const slug = parseRepositorySlug({ slug: repoSlug });
  if (slug.isErr()) {
    return err(GithubLiveErrors.invalidAddress({ message: slug.error.join("; ") }));
  }
  const response = await graphql({
    query: REPOSITORY_RESOLUTION_QUERY,
    variables: { owner: slug.value.owner, repo: slug.value.repo },
  });
  if (response.isErr()) {
    // Compared against the name the request SENT, since that is what GitHub's bullet echoes back.
    const sent = `${slug.value.owner}/${slug.value.repo}`;
    return onlyUnresolved({ error: response.error, repoSlug: sent })
      ? err(GithubLiveErrors.notFound({ identity: repoSlug, kind: "repository" }))
      : err(response.error);
  }
  return parseRepositoryResolution({ data: response.value, repoSlug });
}
