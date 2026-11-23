/**
 * `github repo --push-fresh-cut <record-id>`: push a fresh cut's one root commit to `refs/heads/main` of an empty, private
 * repository, on the preview's digest.
 *
 * This is the step a history re-cut has between `--create` and `--apply-manifest`. `github push` cannot take it: it
 * pushes only a checked-out pull-request branch, and the remote's default branch is unrepresentable there. So this
 * write pushes exactly one thing and refuses unless all of these hold:
 *   - the fresh-cut record reads, and its root is a parentless commit over the recorded tree in the cut's repository;
 *   - the push-root register binds this repository to exactly that root, so the old-history guard already accepts it;
 *   - the repository reads private and not archived;
 *   - the repository holds no ref at all, so `main` does not exist yet and nothing else does either.
 * A parentless commit's history is that one commit, so the old-history guard's own criterion (the root set is the
 * bound root alone) is met by construction, and this write does not run that guard a second time.
 *
 * It does not ask whether `fresh-cut verify` refused: the push lands in a private repository only its owner reads.
 * `--set-public` is the step that asks (`./repoCutStanding.ts`).
 *
 * The approved run asks every one of those again at the send, after the door admitted it: it reads the repository
 * afresh, refuses one whose id or name moved, then runs the plan's own checks over what it read. It pushes with
 * `core.hooksPath=/dev/null`, so a hook added to the cut's repository after it was recorded never runs. Success is a
 * read-back of the remote's refs showing `refs/heads/main` at the root and no other ref.
 *
 * What stays non-atomic is the gap between that last read and the push. A repository made public in that gap is
 * pushed to. A binding changed in that gap does not stop the push. A `main` another actor creates in that gap at
 * another commit makes the non-force push fail. One created at the root itself reads back exactly as this push would
 * have left it, so it is confirmed. Any other ref created in that gap makes the read-back fail after `main` landed,
 * reported unconfirmed: read the repository then, never push again.
 */

import { type FreshCutRecord } from "../../../freshCut/core.js";
import { readFreshCutRecord } from "../../../freshCut/store.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubRepoLifecycleApi, RepoLifecycleState } from "../../../outbound/github/repoLifecycle.js";
import { type GithubVerbError, GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { rootCommitProblem } from "./pushRootCore.js";
import { type ApprovedRepoWrite, type ApprovedWriteOutcome, upstreamRefusedOf } from "./repoApprovedWrite.js";
import { boundRootOf } from "./repoCutStanding.js";

/** The one ref this write creates. */
const MAIN_REF = "refs/heads/main";

/** The Git edges the write reads and pushes through, injectable so a unit test runs no Git. */
export interface FreshCutPushGit {
  /** An isolated read; throws when Git fails. */
  readonly readGit: (args: { cwd: string; args: readonly string[] }) => string;
  /** A visible write; a failure is the one line naming how it ended. */
  readonly writeGit: (args: { cwd: string; args: readonly string[] }) => Result<void, string>;
}

/** One ref as `git ls-remote` lists it. */
interface RemoteRef {
  readonly sha: string;
  readonly ref: string;
}

/**
 * The push URL for a repository: the SSH address, the form this install's checkouts push through.
 *
 * @param fullName the repository's `owner/name` as GitHub answered it
 * @returns the URL `git push` and `git ls-remote` are pointed at
 */
function freshCutPushUrl({ fullName }: { fullName: string }): string {
  return `git@github.com:${fullName}.git`;
}

/**
 * Parse `git ls-remote` output into refs, dropping `HEAD`, which names a branch rather than being one.
 *
 * @param text what Git printed
 * @returns every ref but `HEAD`, or the first line that is not `<sha>\t<ref>`
 */
export function parseRemoteRefs({ text }: { text: string }): Result<readonly RemoteRef[], string> {
  const refs: RemoteRef[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const [sha, ref, ...rest] = line.trim().split(/\s+/);
    if (sha === undefined || ref === undefined || rest.length > 0 || !/^[0-9a-f]{40}$/.test(sha)) {
      return err(line);
    }
    if (ref !== "HEAD") {
      refs.push({ ref, sha });
    }
  }
  return ok(refs);
}

/** Read the remote's refs through Git, or the refusal naming why they could not be read. */
function remoteRefs({
  git,
  cwd,
  url,
  subject,
}: {
  git: FreshCutPushGit;
  cwd: string;
  url: string;
  subject: string;
}): GithubVerbResult<readonly RemoteRef[]> {
  let text: string;
  try {
    text = git.readGit({ args: ["ls-remote", url], cwd });
  } catch (error) {
    const why = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    return err(GithubVerbErrors.repoPushFreshCutRefused({ subject, why: `its refs could not be read (${why})` }));
  }
  const parsed = parseRemoteRefs({ text });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.repoPushFreshCutRefused({ subject, why: `git ls-remote printed "${parsed.error}"` }));
  }
  return ok(parsed.value);
}

/**
 * Why the cut's root is not the commit this write may push: not parentless, or not over the recorded tree.
 *
 * @returns the reason, or undefined when the root is a parentless commit over the recorded tree
 */
function rootProblem({ git, record }: { git: FreshCutPushGit; record: FreshCutRecord }): string | undefined {
  let parentsLine: string | undefined;
  try {
    parentsLine = git.readGit({
      args: ["rev-list", "--parents", "-n", "1", `${record.rootSha}^{commit}`],
      cwd: record.destination,
    });
  } catch {
    parentsLine = undefined;
  }
  const problem = rootCommitProblem({ parentsLine, rootSha: record.rootSha });
  if (problem !== undefined) {
    return problem;
  }
  let tree: string;
  try {
    tree = git.readGit({ args: ["rev-parse", `${record.rootSha}^{tree}`], cwd: record.destination });
  } catch {
    return `${record.rootSha}'s tree could not be read in ${record.destination}`;
  }
  if (tree !== record.treeSha) {
    return `${record.rootSha} is over tree ${tree}, not the recorded ${record.treeSha}`;
  }
  return undefined;
}

/** Why the repository is not one this write may push to: public, internal or archived. */
function repositoryProblem({ current }: { current: RepoLifecycleState }): string | undefined {
  if (!current.private || current.visibility !== "private") {
    return `it reads ${current.visibility}, and a fresh cut is pushed only to a private repository`;
  }
  if (current.archived) {
    return "it is archived";
  }
  return undefined;
}

/**
 * Why the push-root register does not bind this repository to the cut's root.
 *
 * @returns the reason, undefined when it binds exactly that root, or the refusal when the register is unreadable
 */
function bindingProblem({
  home,
  record,
  repositories,
}: {
  home: string;
  record: FreshCutRecord;
  repositories: readonly string[];
}): GithubVerbResult<string | undefined> {
  const bound = boundRootOf({ home, repositories });
  if (bound.isErr()) {
    return err(bound.error);
  }
  if (bound.value === undefined) {
    return ok(`the push-root register binds it to no root; run github push-root record --root ${record.rootSha} first`);
  }
  if (bound.value.rootSha !== record.rootSha) {
    return ok(`the push-root register binds it to ${bound.value.rootSha}, not this cut's root ${record.rootSha}`);
  }
  return ok(undefined);
}

/**
 * The first fact that refuses the push, in order: the repository's state, the push-root binding, the root commit,
 * then any ref the remote already holds. The plan and the send both ask it.
 *
 * @param atSend true at the send, where a ref is one that appeared since the plan
 * @returns the refusal, or undefined when every check holds
 */
function pushRefusal({
  atSend,
  current,
  git,
  home,
  record,
  typed,
  url,
}: {
  atSend: boolean;
  current: RepoLifecycleState;
  git: FreshCutPushGit;
  home: string;
  record: FreshCutRecord;
  typed: string;
  url: string;
}): GithubVerbError | undefined {
  const subject = current.fullName;
  const repository = repositoryProblem({ current });
  if (repository !== undefined) {
    return GithubVerbErrors.repoPushFreshCutRefused({ subject, why: repository });
  }
  const binding = bindingProblem({ home, record, repositories: [typed, current.fullName] });
  if (binding.isErr()) {
    return binding.error;
  }
  if (binding.value !== undefined) {
    return GithubVerbErrors.repoPushFreshCutRefused({ subject, why: binding.value });
  }
  const root = rootProblem({ git, record });
  if (root !== undefined) {
    return GithubVerbErrors.repoPushFreshCutRefused({ subject, why: root });
  }
  const before = remoteRefs({ cwd: record.destination, git, subject, url });
  if (before.isErr()) {
    return before.error;
  }
  if (before.value.length > 0) {
    const refs = before.value.map((entry) => entry.ref).join(", ");
    const holds = atSend ? "now holds" : "already holds";
    return GithubVerbErrors.repoPushFreshCutRefused({ subject, why: `it ${holds} ${refs}` });
  }
  return undefined;
}

/**
 * At the send: read the repository afresh, refuse one whose id or name moved since the plan, ask every plan check
 * again over what was read, then push.
 *
 * @param planned the repository as the plan read it, which the approved digest describes
 * @returns the confirmed push, or the fact that refused it at the send
 */
async function sendFreshCutPush({
  api,
  git,
  home,
  owner,
  planned,
  record,
  repo,
  url,
}: {
  api: GithubRepoLifecycleApi;
  git: FreshCutPushGit;
  home: string;
  owner: string;
  planned: RepoLifecycleState;
  record: FreshCutRecord;
  repo: string;
  url: string;
}): Promise<GithubVerbResult<ApprovedWriteOutcome>> {
  const typed = `${owner}/${repo}`;
  const read = await api.read({ owner, repo });
  if (read.isErr()) {
    return err(upstreamRefusedOf({ error: read.error, operation: `read ${typed}` }));
  }
  const current = read.value;
  if (current.id !== planned.id || current.fullName !== planned.fullName) {
    const why = `it now reads as ${current.fullName} (id ${String(current.id)}), not the approved ${planned.fullName} (id ${String(planned.id)})`;
    return err(GithubVerbErrors.repoPushFreshCutRefused({ subject: planned.fullName, why }));
  }
  const refused = pushRefusal({ atSend: true, current, git, home, record, typed, url });
  if (refused !== undefined) {
    return err(refused);
  }
  return pushAndConfirm({ current, git, record, url });
}

/** Push the root once with hooks off, then require the remote to hold `main` at the root and no other ref. */
function pushAndConfirm({
  git,
  record,
  current,
  url,
}: {
  git: FreshCutPushGit;
  record: FreshCutRecord;
  current: RepoLifecycleState;
  url: string;
}): GithubVerbResult<ApprovedWriteOutcome> {
  const subject = current.fullName;
  const pushed = git.writeGit({
    args: ["-c", "core.hooksPath=/dev/null", "push", url, `${record.rootSha}:${MAIN_REF}`],
    cwd: record.destination,
  });
  if (pushed.isErr()) {
    return err(GithubVerbErrors.repoPushFreshCutRefused({ subject, why: `git push failed: ${pushed.error}` }));
  }
  const after = remoteRefs({ cwd: record.destination, git, subject, url });
  if (after.isErr()) {
    return err(GithubVerbErrors.repoPushFreshCutUnconfirmed({ refs: "unread", subject }));
  }
  const [only, ...others] = after.value;
  if (only === undefined || others.length > 0 || only.ref !== MAIN_REF || only.sha !== record.rootSha) {
    const refs = after.value.map((entry) => `${entry.ref}=${entry.sha.slice(0, 12)}`).join(", ");
    return err(GithubVerbErrors.repoPushFreshCutUnconfirmed({ refs: refs === "" ? "none" : refs, subject }));
  }
  return ok({
    fields: { refs: after.value, repository: current },
    line: `${subject} main is ${record.rootSha}: one branch holding one parentless commit  ${current.htmlUrl}`,
  });
}

/**
 * Read everything the push depends on and build the previewed write, or the fact that refuses it.
 *
 * @param api the lifecycle client the repository is read through
 * @param git the Git edges the cut's repository and the remote are read and pushed through
 * @param home the state home holding the cut record and the push-root register
 * @param owner the owner login typed
 * @param repo the repository name typed
 * @param recordId the fresh cut's record id, as `fresh-cut produce` printed it
 * @returns the write the shared shell previews or sends
 */
export async function planRepoPushFreshCut({
  api,
  git,
  home,
  owner,
  repo,
  recordId,
}: {
  api: GithubRepoLifecycleApi;
  git: FreshCutPushGit;
  home: string;
  owner: string;
  repo: string;
  recordId: string;
}): Promise<GithubVerbResult<ApprovedRepoWrite>> {
  const typed = `${owner}/${repo}`;
  const record = readFreshCutRecord({ home, recordId });
  if (record.isErr()) {
    return err(GithubVerbErrors.repoCutStandingUnreadable({ subject: typed, why: record.error.message }));
  }
  const read = await api.read({ owner, repo });
  if (read.isErr()) {
    return err(upstreamRefusedOf({ error: read.error, operation: `read ${typed}` }));
  }
  const current = read.value;
  const subject = current.fullName;
  const url = freshCutPushUrl({ fullName: current.fullName });
  const refused = pushRefusal({ atSend: false, current, git, home, record: record.value, typed, url });
  if (refused !== undefined) {
    return err(refused);
  }
  const { rootSha, treeSha } = record.value;
  return ok({
    alreadyDone: false,
    change: `push cut ${recordId}'s root ${rootSha} to ${subject} (id ${String(current.id)}, private) as main`,
    consequences: [],
    kind: "push-fresh-cut",
    perform: () => sendFreshCutPush({ api, git, home, owner, planned: current, record: record.value, repo, url }),
    previewCommand: `slopweaver github repo --repo ${typed} --push-fresh-cut ${recordId}`,
    view: {
      action: "push-fresh-cut",
      current: {
        archived: current.archived,
        fullName: current.fullName,
        id: current.id,
        private: current.private,
        visibility: current.visibility,
      },
      cut: { destination: record.value.destination, recordId, rootSha, treeSha },
      precondition: { refs: "none" },
      push: { ref: MAIN_REF, url },
    },
    waiting: [],
  });
}
