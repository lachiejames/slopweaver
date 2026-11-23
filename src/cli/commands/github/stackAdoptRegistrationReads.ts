/**
 * `slopweaver github stack adopt --register-only`'s reads: the repository the session is in, then the child,
 * its chain parent and the pull request below that. Split from `./stackAdoptRegistrationRun.ts`, which plans
 * from these facts, writes inside the door and reads them again to confirm; nothing here writes.
 */
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { err, ok } from "../../../lib/result.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { githubRepoFromRemote, invocationDir, parseRemoteSnapshot } from "./pushCore.js";
import type { GithubPushDeps } from "./pushPrimitives.js";
import type { GithubStackAdoptArgs } from "./stackAdoptCore.js";
import type { RegistrationFacts } from "./stackAdoptRegistrationCore.js";

/** Turn an unknown thrown value into one bounded line, the same way every other shell here does. */
function failureText({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** The repository this session is in, and the remote's own default branch — the only Git this mode reads. */
function repositoryFacts({
  cwd,
  git,
  remote,
}: {
  cwd: string;
  git: GithubPushDeps;
  remote: string;
}): GithubVerbResult<{ readonly owner: string; readonly repo: string; readonly defaultBranch: string }> {
  try {
    const repoRoot = git.readGit({ args: ["rev-parse", "--show-toplevel"], cwd });
    const remoteUrl = git.readGit({ args: ["remote", "get-url", remote], cwd: repoRoot });
    const slug = githubRepoFromRemote({ url: remoteUrl });
    if (slug === undefined) {
      return err(GithubVerbErrors.remoteNotRepository({ remote }));
    }
    const text = git.readGit({ args: ["ls-remote", "--symref", remote, "HEAD"], cwd: repoRoot });
    const snapshot = parseRemoteSnapshot({ branch: "HEAD", text });
    if (snapshot.isErr()) {
      return err(snapshot.error);
    }
    const [owner, name] = slug.split("/");
    return ok({ defaultBranch: snapshot.value.defaultBranch, owner: owner!, repo: name! });
  } catch (error: unknown) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "git", reasons: [failureText({ error })] }));
  }
}

/**
 * Read the child, then the open pull request whose head is its base — the whole of this mode's live reads.
 *
 * The parent lookup is skipped entirely when the base IS the repository default, because there is no chain
 * to register and a lookup would spend a call to learn that.
 *
 * @param args the parsed invocation, naming the child pull request, the remote and the directory to read
 * @param git the Git edges the repository and its default branch are read through
 * @returns the child, its parent and grandparent, the repository and its default branch, or the first failure
 */
export async function readRegistrationFacts({
  api,
  args,
  git,
}: {
  api: GithubWriteApi;
  args: GithubStackAdoptArgs;
  git: GithubPushDeps;
}): Promise<GithubVerbResult<RegistrationFacts>> {
  const repository = repositoryFacts({ cwd: invocationDir({ cwd: args.cwd }), git, remote: args.remote });
  if (repository.isErr()) {
    return err(repository.error);
  }
  const { owner, repo, defaultBranch } = repository.value;
  const child = await api.getPr({ number: args.prNumber, owner, repo });
  if (child.isErr()) {
    return err(GithubVerbErrors.childPrUnread({ cause: child.error.message, number: args.prNumber }));
  }
  // The parent is looked up whatever the base branch is named. Skipping it for a base equal to the
  // repository default would save one call and make the orphan guard's prescribed repair a silent no-op: a
  // pull request's HEAD can BE the default branch, so the default branch is not "nothing is below this".
  const parent = await api.findOpenPrByHead({ head: child.value.baseRef, owner, repo });
  if (parent.isErr()) {
    return err(GithubVerbErrors.basePrUnread({ baseRef: child.value.baseRef, cause: parent.error.message }));
  }
  const grandparent = await readGrandparent({ api, owner, parent: parent.value, repo });
  if (grandparent.isErr()) {
    return err(grandparent.error);
  }
  return ok({ child: child.value, defaultBranch, grandparent: grandparent.value, owner, parent: parent.value, repo });
}

/**
 * The open pull request BELOW the parent, read on EVERY path that has a parent at all.
 *
 * An unstacked parent chained onto another open pull request is the shape `belowWouldBeOrphaned` refuses, and
 * a parent that already carries a stack can never be it — but skipping the read for that case would leave an
 * `add` with no plan-time answer to compare the post-write one against, and the comparison is what separates a
 * chain someone else broke WHILE this verb was writing from one that was already broken when it planned. The
 * first is this verb's business and the second is not, so the read is unconditional and the third provider
 * call is the price of being able to tell them apart.
 *
 * **A "the parent's base is the default branch, so nothing is below it" shortcut is wrong.**
 * `chainParentFor` (`./stackAuditCore.ts`)
 * pairs by head branch and repository and does not exclude the default branch, so an open pull request whose
 * HEAD is `main` makes a parent based on `main` a chain child after all. The shortcut would skip the
 * read in exactly that case and re-open the degradation this guard exists to stop. One provider call on
 * the rarer of the two paths is the price of the guard being total rather than nearly total.
 *
 * @param api the GitHub write surface
 * @param owner the repository owner
 * @param parent the resolved chain parent, or `undefined` when the child chains onto nothing
 * @param repo the repository name
 * @returns the pull request below the parent, or `undefined` when there is none to read
 */
async function readGrandparent({
  api,
  owner,
  parent,
  repo,
}: {
  api: GithubWriteApi;
  owner: string;
  parent: WrittenPr | undefined;
  repo: string;
}): Promise<GithubVerbResult<WrittenPr | undefined>> {
  if (parent === undefined) {
    return ok(undefined);
  }
  const below = await api.findOpenPrByHead({ head: parent.baseRef, owner, repo });
  return below.isErr()
    ? err(GithubVerbErrors.basePrUnread({ baseRef: parent.baseRef, cause: below.error.message }))
    : ok(below.value);
}
