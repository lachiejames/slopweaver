/**
 * What a worktree carries that git commits nowhere: ignored files that are not build output, and stashes made
 * from it.
 *
 * Owner: work or context committed nowhere must never be destroyed. Untracked files, ignored files
 * that are not reproducible build output (path-keyed Codex plan and review records, `.slopweaver` or agent state
 * in the tree), stashes tied to the tree and unpushed commits each hold it. `status --porcelain` already reports
 * an untracked file, and the branch facts already count unpushed commits. The other two are read here.
 *
 * **The allowlist names what is reproducible, never what is precious.** Anything it does not recognise holds the
 * tree, so a new kind of agent state is kept by default and a missing entry costs disk, never work. Its entries
 * were read off every registered worktree with
 * `git -C <tree> ls-files --others --ignored --exclude-standard --directory`. Outside the main checkouts,
 * everything listed was package-manager or build output, acme-admin's codegen, or `.claude/scheduled_tasks.lock`.
 *
 * Both reads go through the injected {@link GitRunner}, and a read git could not answer is `null`, which holds. The
 * one disk read is an `lstat` of a listed entry named like a reproducible directory, to tell a symlink from a file.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";

import type { GitRunner } from "./pruneGit.js";

/**
 * Directories whose whole content a build, an install or a test run writes again.
 *
 * `.vitest-reports` holds the unit lane's blob reporter output (`UNIT_BLOB_DIRECTORY`), which the lane clears and
 * rewrites on every run. `.hook-build` is the PreToolUse hook bundle's esbuild output (`HOOK_BUILD_DIR`,
 * `src/admit/hookBundleBuild.ts`), rebuilt on demand from the tree's own source whenever it is missing or stale.
 * Written here as a literal rather than imported, so this module stays free of the bundler's import graph.
 */
const REPRODUCIBLE_DIRS: ReadonlySet<string> = new Set([
  ".cache",
  ".generated",
  ".hook-build",
  ".next",
  ".nx",
  ".tanstack",
  ".turbo",
  ".vitest-reports",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "dist-cli",
  "generated",
  "gql",
  "node_modules",
  "playwright-report",
  "storybook-static",
  "test-results",
]);

/**
 * File names a tool writes again on its next run.
 *
 * `.gql-target` is the GraphQL target FILE acme-admin's `packages/web-ui/graphql/select-target.sh` writes at the
 * repository root (`echo $TARGET > $REPO_ROOT/.gql-target`), never a directory, so it is matched by name.
 */
const REPRODUCIBLE_NAMES: ReadonlySet<string> = new Set([
  ".DS_Store",
  ".gql-target",
  "install-state.gz",
  "next-env.d.ts",
]);

/** File name endings codegen and the TypeScript build write again. */
const REPRODUCIBLE_SUFFIXES: readonly string[] = [".gen.ts", ".tsbuildinfo", "schema.graphql"];

/**
 * Whole paths, from the tree's root, that are reproducible.
 *
 * `.claude/scheduled_tasks.lock` is a session's mutex: its whole content is the holder's session id, pid and
 * start time, which the next session writes afresh, and a live holder already holds the tree as a live process.
 */
const REPRODUCIBLE_PATHS: readonly RegExp[] = [
  /^\.claude\/scheduled_tasks\.lock$/u,
  /^\.husky\/_\//u,
  /(?:^|\/)\.next-[^/]+\//u,
  /^packages\/graphql\/src\/evModels\/evModelsFragments\.ts$/u,
  /^packages\/zenstack\/logical-[^/]+\.prisma$/u,
  /^packages\/zenstack\/migration-files\//u,
];

/**
 * Whether one ignored entry is build output a tool writes again.
 *
 * @param entry a path from the tree's root, as `ls-files --directory` lists it: a wholly ignored directory ends in `/`
 * @returns true only for an entry the allowlist recognises
 */
export function isReproducibleOutput({ entry }: { entry: string }): boolean {
  if (REPRODUCIBLE_PATHS.some((pattern) => pattern.test(entry))) {
    return true;
  }
  const isDir = entry.endsWith("/");
  const segments = entry.split("/").filter((segment) => segment.length > 0);
  const dirSegments = isDir ? segments : segments.slice(0, -1);
  if (dirSegments.some((segment) => REPRODUCIBLE_DIRS.has(segment))) {
    return true;
  }
  const name = segments.at(-1);
  if (isDir || name === undefined) {
    return false;
  }
  return REPRODUCIBLE_NAMES.has(name) || REPRODUCIBLE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Whether a listed entry could be a symlink standing where a reproducible directory goes — `node_modules` linked to
 * another worktree's, say. git lists a symlink with no trailing `/`, so {@link isReproducibleOutput} reads it as a
 * FILE of that name and holds it, and a file named `dist` is still held: only an entry the disk shows is a link
 * passes, which is why this names the candidates rather than deciding.
 *
 * MEASURED: 24 of 208 slopweaver registrations were held as "1 ignored file(s) no build writes again,
 * such as node_modules", every one a scratchpad worktree whose `node_modules` linked to its parent seat's.
 * Reproduce: `slopweaver worktree prune --json --repo <main checkout>`, then `ls -la <held tree>/node_modules`.
 *
 * A name git printed in bytes that are not UTF-8 decodes to U+FFFD, and `lstat` on the decoded string could find a
 * DIFFERENT path that is a link, so such an entry is never a candidate.
 *
 * @param entry a path from the tree's root, as `ls-files --directory` lists it
 * @returns true when its last segment names a reproducible directory, it carries no trailing `/` and it decoded cleanly
 */
export function isReproducibleLinkCandidate({ entry }: { entry: string }): boolean {
  if (entry.endsWith("/") || entry.includes("�")) {
    return false;
  }
  const name = entry.split("/").at(-1);
  return name !== undefined && REPRODUCIBLE_DIRS.has(name);
}

/**
 * The ignored entries of a listing that are not reproducible.
 *
 * A symlink carries nothing of its own — removing a tree unlinks it and never follows it — so one standing where a
 * reproducible directory goes is reproducible too.
 *
 * @param listing `ls-files -z --others --ignored --exclude-standard --directory` output
 * @param links the entries the disk shows are symlinks, of those {@link isReproducibleLinkCandidate} named
 * @returns each entry the allowlist does not recognise, in git's order
 */
export function uncommittedIgnored({
  listing,
  links,
}: {
  listing: string;
  links: ReadonlySet<string>;
}): readonly string[] {
  return ignoredEntries({ listing })
    .filter((entry) => !isReproducibleOutput({ entry }))
    .filter((entry) => !(links.has(entry) && isReproducibleLinkCandidate({ entry })));
}

/** The entries of an `ls-files -z` listing, in git's order. */
function ignoredEntries({ listing }: { listing: string }): readonly string[] {
  return listing.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Whether a path is a symlink. An entry `lstat` cannot read is not one, so it stays held.
 *
 * @param path the full path
 * @returns true only for a readable symlink
 */
function isSymlinkPath({ path }: { path: string }): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The ignored files in a tree that no build writes again, or `null` when git could not list them.
 *
 * @param git how to run git
 * @param path the worktree to list
 * @returns the entries that hold the tree, empty when every ignored file is build output
 */
export function readIgnoredWork({ git, path }: { git: GitRunner; path: string }): readonly string[] | null {
  // Untrimmed, because a name opening with a space is data: trimmed, ` node_modules` became `node_modules` and passed
  // as a link standing beside it.
  const listing = git({
    args: ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
    cwd: path,
    untrimmed: true,
  });
  if (listing === null) {
    return null;
  }
  const links = new Set(
    ignoredEntries({ listing })
      .filter((entry) => isReproducibleLinkCandidate({ entry }))
      .filter((entry) => isSymlinkPath({ path: join(path, entry) })),
  );
  return uncommittedIgnored({ links, listing });
}

/** The branch a stash subject was made on: `WIP on <branch>: …` or `On <branch>: …`. A ref name cannot hold `:`. */
const STASH_SUBJECT = /^(?:WIP on|On) ([^:]+):/u;

/**
 * How many stashes in a listing were made from this tree.
 *
 * A stash is tied to a tree when its subject names the tree's branch, or when it was made on top of the commit
 * the tree is on now. The second is what ties a detached tree's stash, whose subject says only `(no branch)`.
 *
 * @param listing `stash list --format=%H%x09%P%x09%gs` output, one stash a line
 * @param branch the tree's branch, or `null` for a detached HEAD
 * @param headSha the commit the tree is on now
 * @returns the number of tied stashes
 */
export function stashesTiedTo({
  listing,
  branch,
  headSha,
}: {
  listing: string;
  branch: string | null;
  headSha: string;
}): number {
  return listing
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => {
      const [, parents = "", subject = ""] = line.split("\t");
      const madeOn = STASH_SUBJECT.exec(subject)?.[1];
      return (branch !== null && madeOn === branch) || parents.split(" ")[0] === headSha;
    }).length;
}

/**
 * How many stashes were made from a tree, or `null` when git could not say.
 *
 * The stash list belongs to the whole repository, so a tree is matched against it rather than owning one.
 *
 * @param git how to run git
 * @param path the worktree, whose HEAD ties a stash to it
 * @param branch the tree's branch, or `null` for a detached HEAD
 * @returns the count of tied stashes
 */
export function readTreeStashes({
  git,
  path,
  branch,
}: {
  git: GitRunner;
  path: string;
  branch: string | null;
}): number | null {
  const headSha = git({ args: ["rev-parse", "HEAD"], cwd: path });
  const listing = git({ args: ["stash", "list", "--format=%H%x09%P%x09%gs"], cwd: path });
  if (headSha === null || headSha.length === 0 || listing === null) {
    return null;
  }
  return stashesTiedTo({ branch, headSha, listing });
}
