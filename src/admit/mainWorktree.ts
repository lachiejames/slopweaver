/**
 * The git-topology primitives every main-checkout guard is built on: is a directory the MAIN worktree of its
 * repository, and is it the main worktree of a PARTICULAR repository.
 *
 * Their own module rather than a corner of `mainCheckoutBranchGuard.ts` so `declaredMainCheckouts.ts` — the
 * second key, which the branch guard itself now consults — can read them without the two importing each
 * other. The predicates are unchanged by that move; only their address is new.
 *
 * Resolving "the main worktree" live, rather than pinning a literal path, is deliberate: an absolute home
 * path in this repository's own source would trip its public hygiene gate, and the predicate these need —
 * "is this the ONE checkout every other worktree reads from" — is exactly what git's own `--git-dir` and
 * `--git-common-dir` already distinguish.
 *
 * ## The topology is READ FROM DISK, never asked of a `git` child
 *
 * These predicates run inside the `PreToolUse` dispatcher on every `Bash` call, and `isProtectedMainCheckout`
 * asks them up to three times per target. Forking `git rev-parse` for each answer was six child processes per
 * call, with no timeout, and it was the check that scaled worst under load. MEASURED on a
 * supervisor payload (cwd a linked worktree), a traced bundle of the real registry: main-checkout-guard ran
 * 145–302 ms idle and 480–1941 ms under 30 CPU spinners (load 17–28), against ≤3 ms for every check but admit;
 * a logging `git` stub on PATH recorded exactly those six `rev-parse` calls and no others. `/usr/bin/git` is
 * the Xcode xcrun shim, 51 ms a call serially against 21 ms for Homebrew's. Repro of the fork count, from a
 * linked worktree, with a stub that logs and execs the real git first on PATH:
 *
 *   echo '{"session_id":"t","cwd":"'"$PWD"'","tool_name":"Bash","tool_input":{"command":"echo hi"}}' \
 *     | PATH=<stub dir>:$PATH ./node_modules/.bin/tsx hooks/pretooluse.ts
 *
 * So the two paths are read the way git itself discovers them: the first `.git` walking up from `cwd` is the
 * git dir when it is a DIRECTORY, or names it in a `gitdir:` line when it is a FILE (a linked worktree, or a
 * submodule); that git dir's `commondir` file names the shared repository when it exists, and its absence
 * means the git dir IS the common dir. `src/__tests__/subprocess/admit/hookWallClock.test.ts` holds this read
 * equal to `git rev-parse` on a real `git worktree add` fixture.
 *
 * Where it answers differently from git, each in the protective direction or none: a repository owned by
 * another user (git's `safe.directory` refusal made the fork answer `undefined`), and — the one looser answer —
 * a BARE repository, which has no `.git` to find and reads as no repository at all. A bare repository has no
 * working tree for a main-checkout guard to protect. `GIT_DIR` and friends are ignored, exactly as `gitEnv`
 * stripped them from the fork. A git dir is recognised by its `HEAD` alone, where git also looks for
 * `objects/` and `refs/`, and the walk crosses a mount point, where git's discovery stops at one.
 */
import { execFileSync, type StdioOptions } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { gitEnv } from "../lib/gitRepo.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** The prefix of the one line git writes into a `.git` FILE, `gitdir: <path>`. */
const GITDIR_PREFIX = "gitdir:";

/**
 * The path a `.git` FILE names. Git reads only the file's opening `gitdir:`, so a file that opens with
 * anything else names nothing. A prefix check and a trim rather than one anchored pattern, because a lazy
 * capture beside a trailing `\s*` backtracks polynomially and these bytes are whatever sits in a checkout.
 *
 * @param text the `.git` file's contents
 * @returns the named path, or `undefined` when the file does not open with one
 */
function gitdirNamed({ text }: { text: string }): string | undefined {
  const [firstLine] = text.split("\n", 1);
  if (firstLine === undefined || !firstLine.startsWith(GITDIR_PREFIX)) {
    return undefined;
  }
  const named = firstLine.slice(GITDIR_PREFIX.length).trim();
  if (named.length === 0) {
    return undefined;
  }
  return named;
}

/**
 * Whether a directory carries the `HEAD` git reads first when it asks "is this a git dir".
 *
 * @param gitDir the candidate git dir
 * @returns whether its `HEAD` is there
 */
function carriesHead({ gitDir }: { gitDir: string }): boolean {
  return existsSync(resolve(gitDir, "HEAD"));
}

/**
 * The first `.git` at or above `start`, walking toward the filesystem root. A `.git` DIRECTORY with no `HEAD`
 * is walked past, as git's own discovery does; a `.git` FILE ends the walk whatever it names, as git's does.
 *
 * @param start the absolute directory the walk begins in
 * @returns the `.git` entry's path and whether it is a directory, or `undefined` when no ancestor has one
 */
function nearestDotGit({
  start,
}: {
  start: string;
}): { readonly path: string; readonly isDirectory: boolean } | undefined {
  let dir = start;
  for (;;) {
    const candidate = resolve(dir, ".git");
    try {
      const isDirectory = statSync(candidate).isDirectory();
      if (!isDirectory || carriesHead({ gitDir: candidate })) {
        return { isDirectory, path: candidate };
      }
    } catch {
      // absent here — keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * The git dir and common dir of `cwd`'s repository, canonicalised — what `git rev-parse --git-dir` and
 * `--git-common-dir` report, read from disk rather than asked of a child process (see the file overview).
 *
 * @param cwd the directory to check
 * @returns both paths, or `undefined` when `cwd` is in no repository or its `.git` names nothing readable
 */
function worktreePaths({ cwd }: { cwd: string }): { readonly commonDir: string; readonly gitDir: string } | undefined {
  try {
    const start = resolve(cwd);
    // A cwd that is not a directory is where the fork could not even start, so it answered nothing.
    if (!statSync(start).isDirectory()) {
      return undefined;
    }
    const dotGit = nearestDotGit({ start });
    if (dotGit === undefined) {
      return undefined;
    }
    let gitDir = dotGit.path;
    if (!dotGit.isDirectory) {
      const named = gitdirNamed({ text: readFileSync(dotGit.path, "utf8") });
      if (named === undefined) {
        return undefined;
      }
      gitDir = resolve(dirname(dotGit.path), named);
      if (!carriesHead({ gitDir })) {
        return undefined; // git's "not a git repository" for a gitfile naming a directory that is not one
      }
    }
    let commonDir = gitDir;
    try {
      commonDir = resolve(gitDir, readFileSync(resolve(gitDir, "commondir"), "utf8").trim());
    } catch {
      // no `commondir`: this git dir is its own repository, which is the main worktree's shape
    }
    return { commonDir: realpathSync(commonDir), gitDir: realpathSync(gitDir) };
  } catch {
    return undefined; // unreadable, or a `gitdir:` naming nothing — never block on state this can't confirm
  }
}

/**
 * Whether `cwd` is the main worktree of its repository.
 *
 * @param cwd the directory to check
 * @returns whether it is the repository's main worktree
 */
export function isMainWorktree({ cwd }: { cwd: string }): boolean {
  const paths = worktreePaths({ cwd });
  return paths !== undefined && paths.gitDir === paths.commonDir;
}

/**
 * Whether `cwd` is the main worktree belonging to the repository anchored by `repositoryCwd`.
 *
 * @param cwd the command or file target directory to check
 * @param repositoryCwd the session repository used to pin which repository's main checkout is protected
 * @returns whether the target is that same repository's main worktree
 */
export function isMainWorktreeForRepository({ cwd, repositoryCwd }: { cwd: string; repositoryCwd: string }): boolean {
  const target = worktreePaths({ cwd });
  const repository = worktreePaths({ cwd: repositoryCwd });
  return (
    target !== undefined &&
    repository !== undefined &&
    target.gitDir === target.commonDir &&
    target.commonDir === repository.commonDir
  );
}

/**
 * The remote names configured in `cwd`'s repository — what `git remote` prints, one per line.
 *
 * Needed by {@link ./declaredMainCheckouts.js}'s trunk resolution and nothing else: a declared rebase
 * target such as `origin/staging` names a branch only once its remote prefix is removed, and the ONLY
 * honest way to know which leading segment is a remote name is to ask the repository. Guessing "everything
 * before the first slash" reads a local `release/2.0` as a branch called `2.0`.
 *
 * @param cwd the directory to read the remotes of
 * @returns the configured remote names; empty when `cwd` is not a repository or has no remotes
 */
export function gitRemoteNames({ cwd }: { cwd: string }): readonly string[] {
  try {
    const output = execFileSync("git", ["remote"], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      stdio: ["ignore", "pipe", "ignore"] as StdioOptions,
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return []; // not a repository, or unreadable — the caller falls back to the ref as written
  }
}
