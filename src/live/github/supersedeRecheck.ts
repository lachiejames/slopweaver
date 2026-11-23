/**
 * The close-time re-read of ONE pull request `github bump-drive`'s `close-superseded` act is about to close.
 *
 * The pass plans every close off one read and then closes them one by one, so a base
 * that moves — a revert of the very dependency — or a head the owner pushes to in between leaves a close standing on
 * evidence that is no longer true. So each close re-reads its pull request first and is taken only when the same
 * evidence still holds at the same head (`../../cli/commands/github/bumpDriveClose.ts`).
 *
 * **The residue, stated:** `github close` takes no expected-head or expected-base precondition, so the window
 * between this read and the close is one round trip rather than zero.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { OwnOpenPr } from "../../review/bumpSupersede.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";
import { OWN_PR_FIELDS, ownOpenPrOf } from "./supersedeNodes.js";

const ONE_PR_QUERY = `query SlopweaverSupersedeRecheck($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { state ${OWN_PR_FIELDS} }
  }
}`;

/**
 * One pull request as it stands now, off a raw response.
 *
 * A node naming another pull request is a FAILED read, never one to judge: the close takes the number it ASKED
 * for, so an answer about any other would authorise a close it never examined.
 *
 * @param data the raw GraphQL response
 * @param repoSlug the repository asked about, `owner/name`
 * @param number the pull request asked about
 * @returns the pull request, `undefined` when it is no longer open, or why it could not be read
 */
export function parseRecheck({
  data,
  repoSlug,
  number,
}: {
  data: unknown;
  repoSlug: string;
  number: number;
}): Result<OwnOpenPr | undefined, GithubLiveError> {
  const what = `${repoSlug}#${String(number)}`;
  const repository = isRecord(data) ? data["repository"] : undefined;
  const node = isRecord(repository) ? repository["pullRequest"] : undefined;
  if (!isRecord(node)) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub's re-read of ${what} came back without it` }));
  }
  const named = nodeName({ node });
  if (named === undefined) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub's re-read of ${what} named no pull request` }));
  }
  if (named.toLowerCase() !== what.toLowerCase()) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub's re-read of ${what} answered about ${named}` }));
  }
  const state = node["state"];
  if (state === "CLOSED" || state === "MERGED") {
    return ok(undefined);
  }
  if (state !== "OPEN") {
    return err(GithubLiveErrors.readFailed({ message: `GitHub's re-read of ${what} carried no state this reads` }));
  }
  const pr = ownOpenPrOf({ node });
  if (pr === undefined) {
    return err(
      GithubLiveErrors.readFailed({ message: `GitHub's re-read of ${what} carried a field this decision cannot read` }),
    );
  }
  return ok(pr);
}

/** The `owner/name#n` a raw node names itself as, or `undefined` when either half is missing. */
function nodeName({ node }: { node: Record<string, unknown> }): string | undefined {
  const repository = node["repository"];
  const slug = isRecord(repository) ? repository["nameWithOwner"] : undefined;
  const number = node["number"];
  if (typeof slug !== "string" || typeof number !== "number") {
    return undefined;
  }
  return `${slug}#${String(number)}`;
}

/**
 * Re-read one pull request immediately before it is closed.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @param repoSlug `owner/name`
 * @param number the pull request's number
 * @returns the pull request now, `undefined` when it is no longer open, or why it could not be read
 */
export async function recheckOwnPr({
  graphql,
  repoSlug,
  number,
}: {
  graphql: GithubReadGraphql;
  repoSlug: string;
  number: number;
}): Promise<Result<OwnOpenPr | undefined, GithubLiveError>> {
  const [owner, name] = repoSlug.split("/");
  const response = await graphql({ query: ONE_PR_QUERY, variables: { name, number, owner } });
  return response.andThen((data) => parseRecheck({ data, number, repoSlug }));
}
