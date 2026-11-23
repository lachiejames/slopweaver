/**
 * `github repoint-plan`'s checkout stages: the archive half (every declared main checkout naming the repository,
 * its remotes renamed to the archive and its worktrees disclosed as following them) and the check that the fresh
 * checkout is what the switch needs. Pure — `./repointPlan.ts` composes these over what `./repointReaders.ts` read.
 */
import { githubRepoFromRemote, renameRemoteRepository, sameGithubRepository } from "#lib/githubRemote.js";

import {
  type CheckoutFacts,
  mergeRepointParts,
  type RepointPart,
  type RepositoryRepointFacts,
} from "./repointModel.js";

/**
 * Whether `path` is `root` or sits under it.
 *
 * @returns true when `path` equals `root` or begins with `root` followed by a separator
 */
export function isUnder({ path, root }: { path: string; root: string }): boolean {
  return path === root || path.startsWith(`${root.endsWith("/") ? root : `${root}/`}`);
}

/** Whether a remote config line names `repository`. */
function namesRepository({ url, repository }: { url: string; repository: string }): boolean {
  const named = githubRepoFromRemote({ url });
  return named !== undefined && sameGithubRepository({ left: named, right: repository });
}

/** One declared main checkout git could read. */
type ReadCheckout = Extract<CheckoutFacts, { readonly kind: "read" }>;

/** One read checkout's remotes renamed to the archive, each line it cannot rename left unresolved. */
function remoteRenamePart({
  checkout,
  naming,
  archiveName,
}: {
  checkout: ReadCheckout;
  naming: readonly { readonly key: string; readonly url: string }[];
  archiveName: string;
}): RepointPart {
  const actions: RepointPart["actions"][number][] = [];
  const unresolved: RepointPart["unresolved"][number][] = [];
  for (const line of naming) {
    const toUrl = renameRemoteRepository({ newName: archiveName, url: line.url });
    if (toUrl === undefined) {
      unresolved.push({
        locator: `${checkout.path} ${line.key}`,
        reason: `cannot rename ${line.url}`,
        surface: "git-remote",
      });
      continue;
    }
    actions.push({
      checkout: checkout.path,
      configKey: line.key,
      fromUrl: line.url,
      kind: "git-remote",
      role: "archive",
      toUrl,
    });
  }
  return { actions, observations: [], unresolved };
}

/** Every worktree of an old checkout, disclosed as following its remotes to the archive. */
function worktreeObservations({ checkout }: { checkout: ReadCheckout }): RepointPart["observations"] {
  return checkout.worktrees.map((worktree) => {
    const branch = worktree.branch === null ? "detached" : `branch ${worktree.branch}`;
    return {
      detail: `${branch}; shares ${checkout.path}'s remotes, so it follows them to the archive — never to the fresh repository`,
      disposition: "archive",
      locator: worktree.path,
      surface: "worktree",
    };
  });
}

/**
 * The archive remote actions and worktree observations for the declared checkouts naming the repository.
 *
 * @param archiveName the name the old history moves to under the same owner
 * @returns the stage's part, plus each old checkout's declared path and git's resolved top level of it (for the
 *   overlap check alone)
 */
export function checkoutPart({
  checkouts,
  repository,
  archiveName,
}: {
  checkouts: readonly CheckoutFacts[];
  repository: string;
  archiveName: string;
}): RepointPart & { readonly oldCheckouts: readonly string[]; readonly oldToplevels: readonly string[] } {
  const oldCheckouts: string[] = [];
  const oldToplevels: string[] = [];
  const parts: Partial<RepointPart>[] = [];
  for (const checkout of checkouts) {
    if (checkout.kind === "unreadable") {
      parts.push({ unresolved: [{ locator: checkout.path, reason: checkout.why, surface: "main-checkout" }] });
      continue;
    }
    const naming = checkout.remoteConfig.filter((line) => namesRepository({ repository, url: line.url }));
    if (naming.length === 0) {
      parts.push({
        observations: [
          {
            detail: "no remote names the repository",
            disposition: "unchanged",
            locator: checkout.path,
            surface: "main-checkout",
          },
        ],
      });
      continue;
    }
    oldCheckouts.push(checkout.path);
    oldToplevels.push(checkout.toplevel);
    parts.push(remoteRenamePart({ archiveName, checkout, naming }), {
      observations: worktreeObservations({ checkout }),
    });
  }
  return { ...mergeRepointParts({ parts }), oldCheckouts, oldToplevels };
}

/**
 * Whether the fresh checkout is what the switch needs, or every reason it is not. `oldCheckouts` carries each old
 * checkout's declared path and its resolved top level alike.
 *
 * @returns every problem found, in a fixed order; empty when the fresh checkout is fit or was not read
 */
export function freshCheckoutProblems({
  facts,
  repository,
  oldCheckouts,
}: {
  facts: RepositoryRepointFacts;
  repository: string;
  oldCheckouts: readonly string[];
}): readonly string[] {
  const fresh = facts.newCheckout;
  if (fresh.kind !== "read") {
    return [];
  }
  const problems: string[] = [];
  if (fresh.toplevel !== fresh.path) {
    problems.push(`it is not a checkout's top level (git reports ${fresh.toplevel})`);
  }
  // Both spellings of each side, the declared path and git's resolved top level, so a symlink naming the same
  // directory overlaps as surely as the path itself does.
  const freshSpellings = [fresh.path, fresh.toplevel];
  if (
    oldCheckouts.some((old) =>
      freshSpellings.some((path) => isUnder({ path, root: old }) || isUnder({ path: old, root: path })),
    )
  ) {
    problems.push("it overlaps the old checkout");
  }
  if (!fresh.remoteConfig.some((line) => line.key.endsWith(".url") && namesRepository({ repository, url: line.url }))) {
    problems.push(`no remote of it names ${repository}`);
  }
  if (facts.pushRoot === null) {
    problems.push(`no push root is recorded for ${repository} yet (github push-root record)`);
  } else if (fresh.headRoots.length !== 1 || fresh.headRoots[0] !== facts.pushRoot) {
    problems.push(`its HEAD's roots are ${fresh.headRoots.join(", ")}, not only the recorded root ${facts.pushRoot}`);
  }
  return problems;
}
