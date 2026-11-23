/**
 * The verb half of the commit-message gate (`../../../admit/pushCommitMessageGate.ts`): the hygiene context it
 * scans with, read at the verb's shell, and `github push`'s own call, printed and answered as refused-or-not.
 *
 * Run BEFORE the dry-run stop, so a preview discloses the same refusal a real run would hit, and before the
 * door, so nothing is sent.
 */
import type { GithubPushPlan } from "../../../admit/githubPush.js";
import {
  type CommitMessageHygiene,
  refuseUnpublishableCommitMessages,
  submitCommitMessageRefusal,
} from "../../../admit/pushCommitMessageGate.js";
import { type PrivateTerm, privateTermsOrRefusal } from "../../../hygiene/privateTerms.js";
import { loadDenylistResult, unreadableDenylistMessage } from "../../../hygiene/scan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type InstallationIdentifiersReader,
  reportedInstallationIdentifiers,
} from "../../../outbound/github/installationIdentifiersRead.js";

/**
 * The private denylist and private terms the commit-message scan reads. A denylist that exists and cannot be read
 * refuses; private terms refuse on anything but a load, absence included (`../../../hygiene/privateTerms.ts`).
 *
 * @param home the state home both live under
 * @returns the denylist (empty when there is none) and the terms, or the refusal sentence
 * @internal — exported for its unit test; the verb calls below are its only callers.
 */
export function commitMessagePolicy({
  home,
}: {
  home: string;
}): Result<{ readonly denylist: readonly string[]; readonly privateTerms: readonly PrivateTerm[] }, string> {
  const loaded = loadDenylistResult({ home });
  if (loaded.kind === "unreadable") {
    return err(unreadableDenylistMessage({ load: loaded }));
  }
  const privateTerms = privateTermsOrRefusal({ home });
  if (privateTerms.isErr()) {
    return err(privateTerms.error);
  }
  return ok({ denylist: loaded.kind === "absent" ? [] : loaded.lines, privateTerms: privateTerms.value });
}

/**
 * The edges `github push`'s call reads through.
 * @internal — `GithubPushDeps` satisfies it structurally; nothing outside this module names it.
 */
export interface PushCommitMessageDeps {
  readonly readGit: (args: { cwd: string; args: readonly string[] }) => string;
  readonly out: (args: { line: string }) => void;
  /**
   * The installation's own identifiers for the target, forgiven by the identifier half. Optional so a push-only
   * fake keeps compiling; absent, nothing is forgiven and the scan is as strict as on this build's own repository.
   */
  readonly installationIdentifiers?: InstallationIdentifiersReader | undefined;
}

/**
 * The hygiene context for one target: the denylist and private terms, the target itself, and what it forgives.
 *
 * @param deps the reader and output edges
 * @param home the state home every input is read under
 * @param repo the target repository, `owner/name`
 * @returns the context, or the refusal sentence for an unreadable denylist or private terms that did not load
 */
async function hygieneFor({
  deps,
  home,
  repo,
}: {
  deps: PushCommitMessageDeps;
  home: string;
  repo: string;
}): Promise<Result<CommitMessageHygiene, string>> {
  const policy = commitMessagePolicy({ home });
  if (policy.isErr()) {
    return err(policy.error);
  }
  const reader = deps.installationIdentifiers;
  if (reader === undefined) {
    return ok({ ...policy.value, installationIdentifiers: undefined, ownRepository: repo });
  }
  const installationIdentifiers = await reportedInstallationIdentifiers({
    deps: { installationIdentifiers: reader, out: deps.out },
    home,
    targetRepository: repo,
  });
  return ok({ ...policy.value, installationIdentifiers, ownRepository: repo });
}

/** Print a refused verdict's lines, the first one marked refused. */
function printRefusal({ message, out }: { message: string; out: (args: { line: string }) => void }): void {
  message.split("\n").forEach((line, index) => {
    out({ line: index === 0 ? `refused: ${line}` : line });
  });
}

/**
 * Whether `stack push` must refuse because a commit it would publish carries a message that may not be.
 *
 * The amend `stack push` makes keeps the head commit's message (`commit --amend --no-edit`), so judging the
 * commits reachable from the head it was run over is judging the messages it will send.
 *
 * @param deps the reader and output edges
 * @param home the state home the denylist is read under
 * @param facts the live facts: the repository root, the head commit and the target repository
 * @param remote the configured remote name
 * @param installationIdentifiers what the description gate already read as forgiven for this target
 * @returns true when the refusal was printed and the caller must send nothing
 */
export function stackPushCommitMessagesRefused({
  deps,
  home,
  facts,
  remote,
  installationIdentifiers,
}: {
  deps: Pick<PushCommitMessageDeps, "out" | "readGit">;
  home: string;
  facts: { readonly repoRoot: string; readonly headSha: string; readonly repo: string };
  remote: string;
  installationIdentifiers: CommitMessageHygiene["installationIdentifiers"];
}): boolean {
  const policy = commitMessagePolicy({ home });
  if (policy.isErr()) {
    deps.out({ line: `refused: ${policy.error} nothing was sent.` });
    return true;
  }
  const verdict = refuseUnpublishableCommitMessages({
    hygiene: { ...policy.value, installationIdentifiers, ownRepository: facts.repo },
    localSha: facts.headSha,
    readGit: deps.readGit,
    remote,
    remoteSha: undefined,
    repoRoot: facts.repoRoot,
  });
  if (verdict.isOk()) {
    return false;
  }
  printRefusal({ message: verdict.error.message, out: deps.out });
  return true;
}

/**
 * Why `stack submit` may not send its heads: every commit message across every head that may not be published.
 *
 * Nothing is forgiven by the identifier half here: `stack submit` reads no installation identifiers, so it is as
 * strict as on this build's own repository, which only ever refuses more.
 *
 * @param home the state home the denylist is read under
 * @param plan what the planner admitted
 * @param readGit the isolated Git reader the pushes themselves use
 * @param remote the configured remote name
 * @param repo the target repository, `owner/name`
 * @param repoRoot the repository the heads are in
 * @returns the refusal lines, empty when every message is clean
 */
export function stackSubmitCommitMessageRefusal({
  home,
  plan,
  readGit,
  remote,
  repo,
  repoRoot,
}: {
  home: string;
  plan: { pushes: readonly { branch: string; expectedRemoteSha: string; toSha: string }[] };
  readGit: (args: { cwd: string; args: readonly string[] }) => string;
  remote: string;
  repo: string;
  repoRoot: string;
}): readonly string[] {
  const policy = commitMessagePolicy({ home });
  if (policy.isErr()) {
    return [`refused: ${policy.error} nothing was sent.`];
  }
  const hygiene = { ...policy.value, installationIdentifiers: undefined, ownRepository: repo };
  return submitCommitMessageRefusal({ hygiene, plan, readGit, remote, repoRoot });
}

/**
 * Whether `github push` must refuse because a commit it would publish carries a message that may not be.
 *
 * @param deps the reader and output edges
 * @param home the state home the denylist and identifiers are read under
 * @param plan the safe push plan, naming the head, the remote and the remote branch sha
 * @returns true when the refusal was printed and the caller must send nothing
 */
export async function pushCommitMessagesRefused({
  deps,
  home,
  plan,
}: {
  deps: PushCommitMessageDeps;
  home: string;
  plan: GithubPushPlan;
}): Promise<boolean> {
  const hygiene = await hygieneFor({ deps, home, repo: plan.repo });
  if (hygiene.isErr()) {
    deps.out({ line: `refused: ${hygiene.error} nothing was sent.` });
    return true;
  }
  const verdict = refuseUnpublishableCommitMessages({
    hygiene: hygiene.value,
    localSha: plan.localSha,
    readGit: deps.readGit,
    remote: plan.remote,
    remoteSha: plan.remoteBranchSha,
    repoRoot: plan.repoRoot,
  });
  if (verdict.isOk()) {
    return false;
  }
  printRefusal({ message: verdict.error.message, out: deps.out });
  return true;
}
