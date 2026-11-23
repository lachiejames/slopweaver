/**
 * `github repoint-plan`'s git reads: each declared main checkout's top level, remotes and worktrees, and the fresh
 * checkout's top level, remotes and HEAD's roots — all through the injected `readGit`, READ-ONLY. A checkout git
 * cannot read becomes an `unreadable` fact. `./repointReaders.ts` composes these into the whole gather.
 */
import { isAbsolute } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";

import { parseWorktreeListPorcelain } from "../cmux/worktreeList.js";
import type { CheckoutFacts, RepositoryRepointFacts } from "./repointModel.js";
import type { RepointReadDeps } from "./repointReaders.js";

/** A `git config --get-regexp` read of every remote URL and push URL, as `{ key, url }` lines. */
function remoteConfigOf({
  deps,
  cwd,
}: {
  deps: RepointReadDeps;
  cwd: string;
}): readonly { readonly key: string; readonly url: string }[] {
  let text: string;
  try {
    text = deps.readGit({ args: ["config", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"], cwd });
  } catch {
    // `git config --get-regexp` exits 1 when nothing matches: a checkout with no remote has no lines.
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const space = line.indexOf(" ");
      return { key: line.slice(0, space), url: line.slice(space + 1) };
    });
}

/**
 * One declared main checkout's top level as git resolves it (symlinks followed), its remotes and its worktrees.
 *
 * @returns the checkout's facts, or an `unreadable` fact carrying git's own message
 */
export function checkoutFactsOf({ deps, path }: { deps: RepointReadDeps; path: string }): CheckoutFacts {
  try {
    const toplevel = deps.readGit({ args: ["rev-parse", "--show-toplevel"], cwd: path }).trim();
    const remoteConfig = remoteConfigOf({ cwd: path, deps });
    const worktrees = parseWorktreeListPorcelain({
      text: deps.readGit({ args: ["worktree", "list", "--porcelain"], cwd: path }),
    }).map((tree) => ({ branch: tree.branch, path: tree.path }));
    return { kind: "read", path, remoteConfig, toplevel, worktrees };
  } catch (error: unknown) {
    return { kind: "unreadable", path, why: `git could not read it: ${errorMessage({ error })}` };
  }
}

/**
 * The fresh checkout's top level, remotes and HEAD's roots, or why it could not be read.
 *
 * @param path the `--new-checkout` value, `undefined` when the flag was not given
 * @returns `not-given`, an `unreadable` fact (a relative path, or git's message), or what git read
 */
export function newCheckoutFactsOf({
  deps,
  path,
}: {
  deps: RepointReadDeps;
  path: string | undefined;
}): RepositoryRepointFacts["newCheckout"] {
  if (path === undefined) {
    return { kind: "not-given" };
  }
  if (!isAbsolute(path)) {
    return { kind: "unreadable", path, why: "--new-checkout must be an absolute path" };
  }
  try {
    const toplevel = deps.readGit({ args: ["rev-parse", "--show-toplevel"], cwd: path }).trim();
    const headRoots = deps
      .readGit({ args: ["--no-replace-objects", "rev-list", "--max-parents=0", "HEAD"], cwd: path })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { headRoots, kind: "read", path, remoteConfig: remoteConfigOf({ cwd: path, deps }), toplevel };
  } catch (error: unknown) {
    return { kind: "unreadable", path, why: `git could not read it: ${errorMessage({ error })}` };
  }
}
