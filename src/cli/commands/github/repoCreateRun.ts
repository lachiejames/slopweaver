/**
 * `github repo --create`: create a repository, PRIVATE unless `--public` says otherwise, on the preview's digest.
 *
 * There is no immutable id before a repository exists, so the digest binds what proves the write is the one
 * previewed: the owning account's id and type, the address answering 404, and the exact request body. The apply
 * run resolves the owner and reads the address again, so an approval given while the address was free cannot
 * create over a repository that appeared since. Success is a read-back of the address showing the id GitHub's
 * create answered with, and the privacy asked for. The race between that fresh 404 and the create is GitHub's to
 * settle — a name taken in between is refused by GitHub, and nothing here claims a repository it did not make.
 */

import { formatIngestError } from "../../../lib/ingestError.js";
import { err, ok } from "../../../lib/result.js";
import type { GithubAccount, GithubRepoLifecycleApi } from "../../../outbound/github/repoLifecycle.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import {
  type ApprovedRepoWrite,
  type ApprovedWriteOutcome,
  upstreamRefusedOf as refused,
} from "./repoApprovedWrite.js";

/** The HTTP status GitHub answers for an address that holds no repository. */
const HTTP_NOT_FOUND = 404;

/** The resolved create: where, and whether it is private. */
export interface RepoCreateRequest {
  readonly owner: string;
  readonly repo: string;
  readonly private: boolean;
}

/** Who will own the new repository, as resolved from the token and the address. */
interface OwnerIdentity {
  readonly kind: "authenticated-user" | "organization";
  readonly id: number;
  readonly login: string;
}

/**
 * Resolve the owner: the token's own account when the login matches it, else an organisation, else refused.
 *
 * @returns the owner identity the digest binds
 */
async function resolveOwner({
  api,
  owner,
}: {
  api: GithubRepoLifecycleApi;
  owner: string;
}): Promise<GithubVerbResult<OwnerIdentity>> {
  const me = await api.authenticatedAccount();
  if (me.isErr()) {
    return err(refused({ error: me.error, operation: "read the token's own account" }));
  }
  if (me.value.login.toLowerCase() === owner.toLowerCase()) {
    return ok({ id: me.value.id, kind: "authenticated-user", login: me.value.login });
  }
  const account = await api.account({ login: owner });
  if (account.isErr()) {
    return err(refused({ error: account.error, operation: `read account ${owner}` }));
  }
  return organizationOf({ account: account.value, me: me.value, owner });
}

/** Accept an organisation; refuse a personal account that is not the token's own. */
function organizationOf({
  account,
  me,
  owner,
}: {
  account: GithubAccount;
  me: GithubAccount;
  owner: string;
}): GithubVerbResult<OwnerIdentity> {
  if (account.type !== "Organization") {
    return err(GithubVerbErrors.repoOwnerNotCreatable({ account: me.login, owner }));
  }
  return ok({ id: account.id, kind: "organization", login: account.login });
}

/** Require nothing at the address: a 404 is the only witness that it is free. */
async function requireAbsent({
  api,
  request,
}: {
  api: GithubRepoLifecycleApi;
  request: RepoCreateRequest;
}): Promise<GithubVerbResult<void>> {
  const read = await api.read({ owner: request.owner, repo: request.repo });
  if (read.isOk()) {
    return err(GithubVerbErrors.repoAddressTaken({ fullName: read.value.fullName, id: read.value.id }));
  }
  if (read.error.kind === "http" && read.error.status === HTTP_NOT_FOUND) {
    return ok(undefined);
  }
  return err(refused({ error: read.error, operation: `read ${request.owner}/${request.repo}` }));
}

/** Send the create once, then require the address to show the id GitHub answered with, and the privacy asked. */
async function createAndConfirm({
  api,
  request,
  identity,
}: {
  api: GithubRepoLifecycleApi;
  request: RepoCreateRequest;
  identity: OwnerIdentity;
}): Promise<GithubVerbResult<ApprovedWriteOutcome>> {
  const target = `${request.owner}/${request.repo}`;
  const org = identity.kind === "organization" ? identity.login : undefined;
  const sent = await api.create({ name: request.repo, org, private: request.private });
  if (sent.isErr()) {
    return err(refused({ error: sent.error, operation: `create ${target}` }));
  }
  const read = await api.read({ owner: request.owner, repo: request.repo });
  if (read.isErr()) {
    const cause = `read-back: ${formatIngestError({ error: read.error })}`;
    return err(GithubVerbErrors.repoCreateUnconfirmed({ cause, id: sent.value.id, target }));
  }
  const landed =
    read.value.id === sent.value.id &&
    read.value.fullName.toLowerCase() === target.toLowerCase() &&
    read.value.private === request.private &&
    // An organisation can answer `internal`, which is not private yet is not public either.
    read.value.visibility === (request.private ? "private" : "public");
  if (!landed) {
    return err(GithubVerbErrors.repoCreateUnconfirmed({ cause: undefined, id: sent.value.id, target }));
  }
  return ok({
    fields: { repository: read.value },
    line: `created ${read.value.fullName} (id ${String(read.value.id)}, ${read.value.visibility})  ${read.value.htmlUrl}`,
  });
}

/**
 * Read what a create depends on and build the previewed write: the owner resolved, the address free, the body.
 *
 * @param api the lifecycle client
 * @param request the address and privacy asked for
 * @returns the write the shared shell previews or sends, or the fact that refuses it
 */
export async function planRepoCreate({
  api,
  request,
}: {
  api: GithubRepoLifecycleApi;
  request: RepoCreateRequest;
}): Promise<GithubVerbResult<ApprovedRepoWrite>> {
  const identity = await resolveOwner({ api, owner: request.owner });
  if (identity.isErr()) {
    return err(identity.error);
  }
  const absent = await requireAbsent({ api, request });
  if (absent.isErr()) {
    return err(absent.error);
  }
  const target = `${request.owner}/${request.repo}`;
  const privacy = request.private ? "private" : "PUBLIC";
  const ownerWord = identity.value.kind === "organization" ? "organisation" : "the token's own account";
  return ok({
    alreadyDone: false,
    change: `create ${target} as a ${privacy} repository owned by ${ownerWord} ${identity.value.login}`,
    consequences: request.private ? [] : ["the new repository is readable by anyone from the moment it exists"],
    kind: "create",
    perform: () => createAndConfirm({ api, identity: identity.value, request }),
    previewCommand: `slopweaver github repo --repo ${target} --create${request.private ? "" : " --public"}`,
    view: {
      action: "create",
      owner: { id: identity.value.id, kind: identity.value.kind, login: identity.value.login },
      precondition: { repository: "absent", status: HTTP_NOT_FOUND },
      request: { name: request.repo, private: request.private },
      target,
    },
    waiting: [],
  });
}
