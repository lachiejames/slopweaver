/**
 * Refuses a remote-facing `git` command that names no repository and would resolve to the STATE HOME's own.
 *
 * `$SLOPWEAVER_HOME` is itself a git checkout of a private state repository, so a bare `git` issued from any
 * directory under it answers about THAT repository. MEASURED: a
 * sweep `cd`'d into `supervisor-scratch/handoff-<n>` under the home and ran `git fetch -q origin main; git
 * rev-parse --short origin/main`, read the state repository's `main`, and graded slopweaver's
 * `main` as moved; `git -C <worktree>` read the real one. Nothing was written, but a wrong
 * trunk SHA is exactly the input a landing decision reads.
 *
 * The verb layer already refuses this class — `../config.ts`'s `cwdRepositoryRefusal`, from the
 * watcher that read `totalCount 0` off the state repository for three days. This is the same policy for raw
 * `git` through the `Bash` tool, which no verb sees.
 *
 * ## The criterion, per command segment
 *
 * 1. The segment is `git`, and names no repository itself: no `-C`, `--git-dir` or `--work-tree` global and
 *    no inline `GIT_DIR=`/`GIT_WORK_TREE=`. Naming one is the remedy, so it always passes — including naming
 *    the home deliberately.
 * 2. It is REMOTE-FACING: a subcommand in {@link REMOTE_SUBCOMMANDS}, or any argument naming a remote-tracking
 *    ref (`origin/…`, `@{u}`, `@{upstream}`, `@{push}`). A local read in the home — `git ls-files`, `git
 *    status` — is deliberate work on the state repository (`skills/home/SKILL.md` measures one) and is not
 *    the wrong-repository class.
 * 3. The repository git would discover from the segment's resolved directory IS the home's: the first
 *    ancestor holding a `.git` entry is the home itself. A checkout nested under the home has its own `.git`
 *    and is its own repository, so it passes.
 *
 * The directory walk runs only after the token criterion matched, so an ordinary `Bash` call pays nothing
 * for it, and it is `stat`s rather than a `git rev-parse` fork — the fold that made `PreToolUse` one
 * process exists to take CPU off every tool call (`docs/hooks/registered-and-bounded.md`).
 *
 * Fails OPEN, like the main-checkout guards beside it: a directory the static resolver cannot determine —
 * `cd "$X"`, `git -C ~/…`, anything after a `pushd`/`popd` — allows, and so does any `GIT_DIR=` or
 * `GIT_WORK_TREE=` in the command, whose reach is shell scoping this does not model. A workflow tripwire,
 * not a boundary.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { gitSubcommand, stripEnvPrefix, toolName } from "./commandTokens.js";
import { hasSegmentInlineEnvironmentOverride, resolveMainCheckoutCommandTargets } from "./mainCheckoutCommandTarget.js";

/** The ambient hatch this gate is opened with — declared as `home-git-implicit` in `../hatch/registry.ts`. */
export const HOME_GIT_IMPLICIT_HATCH = "SLOPWEAVER_ALLOW_HOME_GIT_IMPLICIT";

/** Subcommands that talk to, or integrate from, a remote — every one answers about whichever repository git found. */
const REMOTE_SUBCOMMANDS: ReadonlySet<string> = new Set(["fetch", "pull", "merge", "rebase", "push", "ls-remote"]);

/** A global that names the repository explicitly: `-C <dir>`, `-C<dir>`, `--git-dir[=]…`, `--work-tree[=]…`. */
const REPOSITORY_GLOBAL = /^(?:-C|--git-dir(?:=|$)|--work-tree(?:=|$))/u;

/** Inline assignments that name the repository explicitly. */
const REPOSITORY_ENV = /(?:^|\s)GIT_(?:DIR|WORK_TREE)=/u;

/** An argument naming a remote-tracking ref: `origin/main`, `origin/main..HEAD`, `HEAD@{u}`, `@{upstream}`. */
const REMOTE_REF = /(?:^|[^A-Za-z0-9_-])origin\/|@\{(?:u|upstream|push)\}/u;

/** Directory-stack builtins the static resolver does not follow, so every segment after one is unresolved. */
const DIRECTORY_STACK: ReadonlySet<string> = new Set(["pushd", "popd"]);

/**
 * Whether one `git` segment names its repository itself, which is the remedy and always passes.
 *
 * @param segment the raw segment text, env prefix included
 * @param globals the tokens between `git` and its subcommand
 * @returns whether a `-C`, `--git-dir`, `--work-tree` or `GIT_DIR=`/`GIT_WORK_TREE=` is present
 */
function namesRepository({ segment, globals }: { segment: string; globals: readonly string[] }): boolean {
  return globals.some((token) => REPOSITORY_GLOBAL.test(token)) || REPOSITORY_ENV.test(segment);
}

/**
 * Whether a segment moves the shell's directory in a way {@link resolveMainCheckoutCommandTargets} does not
 * follow — `pushd`/`popd` — so the resolved directory of every later segment is a guess.
 *
 * @param segment one command segment
 * @returns whether the segment is a directory-stack builtin
 */
function losesDirectory({ segment }: { segment: string }): boolean {
  const first = segment.trim().split(/\s+/u)[0];
  return first !== undefined && DIRECTORY_STACK.has(first);
}

/**
 * What a bare, remote-facing `git` segment is about to do, or `undefined` when the segment is out of scope —
 * not `git`, a local read, or one that names its repository.
 *
 * @param segment one command segment
 * @returns the subcommand and the argument that made it remote-facing, for the refusal line
 */
export function bareRemoteGit({ segment }: { segment: string }): { sub: string; trigger: string } | undefined {
  const tokens = stripEnvPrefix({
    tokens: segment
      .trim()
      .split(/\s+/u)
      .filter((token) => token.length > 0),
  });
  const first = tokens[0];
  if (first === undefined || toolName({ first }) !== "git") {
    return undefined;
  }
  const { sub, flags, globals } = gitSubcommand({ tokens });
  if (sub === undefined || namesRepository({ globals, segment })) {
    return undefined;
  }
  if (REMOTE_SUBCOMMANDS.has(sub)) {
    return { sub, trigger: `git ${sub}` };
  }
  const ref = flags.find((token) => REMOTE_REF.test(token));
  return ref === undefined ? undefined : { sub, trigger: ref };
}

/**
 * The root of the repository git would discover from `cwd` — the first ancestor, `cwd` included, holding a
 * `.git` entry (a directory for a checkout, a file for a worktree or submodule) — or `undefined` outside one.
 *
 * @param cwd an absolute directory
 * @returns that repository's root
 */
export function discoveredRepositoryRoot({ cwd }: { cwd: string }): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** One refused segment: what it would have run, where, and what made it remote-facing. */
export interface HomeGitHit {
  /** The segment's own text. */
  readonly segment: string;
  /** The directory it resolved to, under the state home. */
  readonly cwd: string;
  /** The subcommand or argument that made it remote-facing. */
  readonly trigger: string;
}

/**
 * The first segment of a `Bash` command that is a bare remote-facing `git` resolving to the state home's own
 * repository, or `undefined` when none is.
 *
 * @param command the raw `Bash` command
 * @param cwd the directory the tool call runs in
 * @param stateHome the resolved state home
 * @param repositoryRoot the discovery rule, injectable so a test owns the filesystem
 * @returns the refused segment, or `undefined` to allow
 */
export function evaluateHomeGitGuard({
  command,
  cwd,
  stateHome,
  repositoryRoot = discoveredRepositoryRoot,
}: {
  command: string;
  cwd: string;
  stateHome: string;
  repositoryRoot?: (args: { cwd: string }) => string | undefined;
}): HomeGitHit | undefined {
  // An exported `GIT_DIR`/`GIT_WORK_TREE` anywhere in the command aims every later git elsewhere, and which
  // segments it reaches is shell scoping this does not model — so its presence at all fails open.
  if (REPOSITORY_ENV.test(command)) {
    return undefined;
  }
  const home = resolve(stateHome);
  for (const target of resolveMainCheckoutCommandTargets({ command, cwd })) {
    if (losesDirectory({ segment: target.command })) {
      return undefined;
    }
    const bare = bareRemoteGit({ segment: target.command });
    if (bare === undefined || target.cwd === undefined) {
      continue;
    }
    if (repositoryRoot({ cwd: target.cwd }) !== home) {
      continue;
    }
    const overridden = hasSegmentInlineEnvironmentOverride({
      command,
      name: HOME_GIT_IMPLICIT_HATCH,
      segmentIndex: target.segmentIndex,
    });
    if (overridden) {
      continue;
    }
    return { cwd: target.cwd, segment: target.command.trim(), trigger: bare.trigger };
  }
  return undefined;
}
