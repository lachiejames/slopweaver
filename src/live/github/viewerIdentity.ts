/**
 * Whose the stored GitHub token is, as the two facts a commit identity needs: the login and the account's numeric
 * id. GitHub's own no-reply address is built from exactly those two (`<id>+<login>@users.noreply.github.com`), so a
 * caller that must sign as the owner without putting the owner's address in code reads it here, through the door.
 *
 * Separate from `./coderabbitYield.ts`'s `viewerLogin`, whose query asks for the login alone: widening that query
 * would change what an unrelated report reads.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { fieldOf } from "./coderabbitYieldWalk.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** The one query: the token owner's login and numeric account id, nothing else. */
const VIEWER_IDENTITY_QUERY = "query SlopweaverViewerIdentity { viewer { login databaseId } }";

/** A GitHub user login's shape: an `org/team` or an empty string is refused rather than signed with. */
const LOGIN_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The token owner as a commit identity needs them. */
export interface GithubViewerIdentity {
  readonly login: string;
  readonly databaseId: number;
}

/**
 * Pure: read the viewer's login and numeric id out of a GraphQL answer, refusing any other shape.
 *
 * @param response the GraphQL `data` the door returned
 * @returns the identity, or why the answer is not one
 */
export function parseViewerIdentity({
  response,
}: {
  response: unknown;
}): Result<GithubViewerIdentity, GithubLiveError> {
  const viewer = fieldOf({ key: "viewer", value: response });
  const login = fieldOf({ key: "login", value: viewer });
  const databaseId = fieldOf({ key: "databaseId", value: viewer });
  if (typeof login !== "string" || !LOGIN_SHAPE.test(login)) {
    return err(GithubLiveErrors.readFailed({ message: "GitHub returned no user login for the token's owner" }));
  }
  if (typeof databaseId !== "number" || !Number.isSafeInteger(databaseId) || databaseId <= 0) {
    return err(
      GithubLiveErrors.readFailed({ message: "GitHub returned no positive numeric id for the token's owner" }),
    );
  }
  return ok({ databaseId, login });
}

/**
 * Read the token owner's login and numeric id through the GitHub read door.
 *
 * @param graphql the safe-wrapped GraphQL seam
 * @returns the identity, or the read or shape failure
 */
export async function viewerIdentity({
  graphql,
}: {
  graphql: GithubReadGraphql;
}): Promise<Result<GithubViewerIdentity, GithubLiveError>> {
  const response = await graphql({ query: VIEWER_IDENTITY_QUERY, variables: {} });
  if (response.isErr()) {
    return err(response.error);
  }
  return parseViewerIdentity({ response: response.value });
}

/**
 * Pure: GitHub's no-reply commit address for an account, the form that ties a commit to the account without
 * publishing a real mailbox.
 *
 * @param identity the account's login and numeric id
 * @returns `<databaseId>+<login>@users.noreply.github.com`
 */
export function githubNoReplyAddress({ identity }: { identity: GithubViewerIdentity }): string {
  return `${String(identity.databaseId)}+${identity.login}@users.noreply.github.com`;
}
