/**
 * The one way every gate locates the repository it is supposed to be checking.
 *
 * ## Why this exists — the gates were inert in the hook that runs them
 *
 * Each gate anchored itself with `git -C <its own directory> rev-parse --show-toplevel`, which is correct
 * from a shell and wrong from a git hook. **Git exports `GIT_DIR` to its hooks, and `GIT_DIR` overrides
 * `-C`.** With it set, `--show-toplevel` stops reporting the repository root and reports the `-C` directory
 * itself, so the root came back as `…/src/devLint`. The gate then listed one tree's files and tried to read
 * them from another; every read failed; and because the read loops swallowed a failure and counted LISTED
 * files rather than read ones, the gates printed `clean (286 sources scanned)` having opened nothing.
 *
 * Measured, not reasoned: planting a real `push(...spread)` in a disk-reading module is caught by
 * `unbounded-spread` from a shell and reported `clean` under a hook environment. That covers every bespoke
 * ratchet and `src/hygiene/scan.ts`, the public leak gate — the one this repo calls non-negotiable. CI runs
 * `yarn lint` directly and was never affected; the `pre-push` hook, which is the ONLY enforcer of coverage
 * and the coverage ratchet, was.
 *
 * Three rules follow, and all three are load-bearing:
 *
 *  1. every git call a gate makes goes through {@link gitEnv}, so no ambient `GIT_DIR` / `GIT_WORK_TREE`
 *     can redirect it;
 *  2. a file a gate could not read is a FAILURE, never a skip — a file that was not read was not checked;
 *  3. a file a gate never LISTED is that same class, so {@link workingTreeFilesOf} lists the WORKING TREE —
 *     every file git does not ignore, committed or not — rather than the index.
 *
 * ## Why rule 3 is a rule
 *
 * The listing used to be a bare `git ls-files`, which reads the INDEX. So a module that existed on disk but
 * had not been committed was scanned by nothing: not `../admit/coverage.ts`, not `../hygiene/scan.ts`, not
 * one devLint gate. MEASURED on a branch adding a generation swap: two
 * consecutive clean `yarn validate:local` runs reported `door coverage: 100% of 392 direct seams accounted
 * for` while `src/atlas/kit/generationSwap.ts` sat uncommitted carrying four unaccounted seams (one
 * `unlinkSync`, three `renameSync`), and the same gate reported `99% of 396` and named all four the moment
 * the file was committed. The cost was a whole `pre-push` lap spent discovering what `pre-commit` could have
 * named, and the direction is the dangerous one — CLEAN for work nothing had read. Reproduce the gap with
 * `git ls-files | wc -l` against `git ls-files --cached --others --exclude-standard | wc -l` on a tree
 * holding one new file.
 *
 * ## The second family: where the PROCESS is standing
 *
 * A gate anchors on its own module because it must scan the tree it was loaded from. A runtime verb must
 * do the opposite — anchor on `process.cwd()` — because under a marketplace plugin install its module was
 * copied into a directory tree with no `.git` above it at all, and a module-anchored lookup then throws on
 * every call forever. {@link runningCheckoutRoot} and {@link runningCheckoutBranch} are that family, and
 * the `running-checkout-root` gate in `yarn lint` is what keeps the two apart; both carry the measured
 * incident that separated them.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** `--cached` (the index) plus `--others` (what is not in it) minus the standard ignores: the working tree. */
const WORKING_TREE_FLAGS = ["--cached", "--others", "--exclude-standard"] as const;

/**
 * A copy of the process environment with the two variables that override `-C` removed.
 *
 * @returns the environment to hand every `git` invocation in a gate
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // GIT_DIR / GIT_WORK_TREE redirect which repository is read. GIT_INDEX_FILE redirects which INDEX is read,
  // and an index that does not exist makes `ls-files` exit 0 with no paths at all — which reads as "nothing
  // to check" rather than as a fault. Strip all of them.
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  delete env["GIT_INDEX_FILE"];
  delete env["GIT_OBJECT_DIRECTORY"];
  delete env["GIT_COMMON_DIR"];
  return env;
}

/**
 * The repository root containing a given module, immune to an ambient `GIT_DIR`.
 *
 * Anchored on the CALLER's own file rather than on `cwd`, so a gate scans the checkout it was loaded from
 * even when invoked from elsewhere.
 *
 * @param importMetaUrl the calling module's `import.meta.url`
 * @returns the absolute path of the repository root
 */
export function repoRootOf({ importMetaUrl }: { importMetaUrl: string }): string {
  const here = dirname(fileURLToPath(importMetaUrl));
  return execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    env: gitEnv(),
    killSignal: "SIGKILL",
    timeout: GIT_READ_TIMEOUT_MS,
  }).trim();
}

/**
 * The repository root containing a given DIRECTORY, immune to an ambient `GIT_DIR`.
 *
 * Anchored on an explicit directory rather than the calling module's own file — see {@link repoRootOf} for
 * that variant, which resolves via `import.meta.url` and throws when the caller's module was copied out of
 * git entirely (a marketplace plugin mirror carries no `.git` at all). Use this one whenever the directory
 * that matters is where the process is actually STANDING (`process.cwd()`), not where its code happens to
 * live on disk.
 *
 * @param dir the directory to resolve from
 * @param env the environment git runs under, {@link gitEnv} unless a caller must strip more
 * @returns the absolute path of the repository root
 */
export function repoRootFromDirectory({ dir, env = gitEnv() }: { dir: string; env?: NodeJS.ProcessEnv }): string {
  const printed = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    env,
    killSignal: "SIGKILL",
    timeout: GIT_READ_TIMEOUT_MS,
  });
  // Strip the ONE terminator git prints, never `.trim()`: a directory name may legally end in a space, and
  // trimming turns `/x/repo ` into `/x/repo` — a DIFFERENT directory, which may be a different checkout.
  // Review reproduced exactly that against `talk code`, reading a sibling
  // checkout's tracked file from a server standing in `repo /site`. A name ending in a literal newline is
  // still ambiguous here, because git's own output would be too.
  if (printed.endsWith("\n")) {
    return printed.slice(0, -1);
  }
  return printed;
}

/**
 * The repository root of the checkout this process is STANDING in — never throws.
 *
 * ## Why a runtime verb must use this and never {@link repoRootOf}
 *
 * {@link repoRootOf} anchors on the calling module's own file, which is right for a gate (it must scan the
 * tree it was loaded from) and wrong for a verb. Under a marketplace plugin install the installer copies
 * source files into `~/.claude/plugins/data/<plugin>/mirror/…` as a plain directory tree with **no `.git`
 * anywhere above them**, so a module's own location is not inside a repository at all and `repoRootOf`
 * throws — deterministically, on every call, for the life of that install.
 *
 * MEASURED: the answer path did exactly that.
 * `../live/turn/posterAnswer.ts` built its gate list with `repoRootOf`, the mirror had no `.git`, and a
 * composed, reviewed, verdict-clean answer to the owner's own work order was destroyed at send time with
 * `git -C …/mirror/a/src/live/turn rev-parse --show-toplevel, fatal: not a git repository`. Reproduce the
 * throw with that command against any mirror path; `../cmux/pluginDir.ts`'s header records the same class
 * hitting `cmux spawn` earlier, which is why this is a shared primitive rather than a
 * second local fix.
 *
 * `process.cwd()` is the right anchor because `bin/slopweaver` `exec`s its Node process without ever
 * `cd`-ing: cwd is always the directory the operator invoked `slopweaver` from. It FALLS BACK to `cwd`
 * itself rather than throwing when cwd is not a repository (or `git` cannot be run), because every caller
 * wants a directory to look in, and none of them is worth destroying a turn over.
 *
 * @param cwd the directory the process is standing in; defaults to `process.cwd()`
 * @returns cwd's own repository root, or `cwd` itself when it is not (or cannot be checked as) a repository
 */
export function runningCheckoutRoot({ cwd = process.cwd() }: { cwd?: string } = {}): string {
  try {
    return repoRootFromDirectory({ dir: cwd });
  } catch {
    return cwd;
  }
}

/**
 * The repository root this process's own CODE was loaded from, or `undefined` when that is no repository —
 * never throws.
 *
 * The second anchor beside {@link runningCheckoutRoot}, for a process that stands OUTSIDE every checkout on
 * purpose. The hourly prune trigger launches `automation run-due` with the state home as its working directory
 * (`../worktree/pruneTriggerDetach.ts`, so the detached job never holds a caller's worktree open), and from there
 * cwd names no repository. MEASURED: a `worktree-prune` firing killed mid-run filed its p0 finding naming no
 * repo, so nothing could seat it until a hand `set-repo`. Repro:
 * `grep -n "names no repo" "$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log"`.
 *
 * `undefined` rather than a throw under a marketplace plugin mirror, which carries no `.git` (see
 * {@link runningCheckoutRoot}): a caller then keeps the cwd anchor's own answer. Resolved through
 * {@link repoRootFromDirectory}, never {@link repoRootOf}, whose `.trim()` would turn a root ending in a space into
 * a sibling directory that may be another repository, and under {@link codeDiscoveryEnv}, so an inherited
 * discovery ceiling cannot hide the checkout the code sits in.
 *
 * @returns the code's own repository root, or `undefined` when it is not inside one
 */
export function codeCheckoutRoot(): string | undefined {
  try {
    return repoRootFromDirectory({
      dir: dirname(fileURLToPath(import.meta.url)),
      env: codeDiscoveryEnv({ env: gitEnv() }),
    });
  } catch {
    return undefined;
  }
}

/**
 * An environment with git's discovery ceiling removed, for asking which repository a file ON DISK sits in.
 *
 * `GIT_CEILING_DIRECTORIES` is a caller's choice about where ITS cwd search stops, and an inherited one set at or
 * below the code's own checkout root makes `rev-parse` refuse to climb to that root — so the code's checkout reads
 * as no repository and a process outside every checkout gets a refusal instead of its own repository. Where the
 * code is loaded from is a fact about the filesystem, not about that caller's search.
 *
 * @param env the environment to copy, usually {@link gitEnv}'s
 * @returns a copy of `env` without `GIT_CEILING_DIRECTORIES`
 */
export function codeDiscoveryEnv({ env }: { env: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy["GIT_CEILING_DIRECTORIES"];
  return copy;
}

/**
 * The current branch of the repository containing a given module, immune to an ambient `GIT_DIR`.
 *
 * `--show-current` prints an empty line rather than failing on a detached HEAD, so that case is mapped to
 * `undefined` here instead of travelling as `""` or as the literal string `HEAD` (which `rev-parse
 * --abbrev-ref HEAD` would print, and which is indistinguishable from a branch actually named `HEAD`).
 *
 * @param importMetaUrl the calling module's `import.meta.url`
 * @returns the branch name, or `undefined` on a detached HEAD
 */
export function currentBranchOf({ importMetaUrl }: { importMetaUrl: string }): string | undefined {
  const here = dirname(fileURLToPath(importMetaUrl));
  const name = execFileSync("git", ["-C", here, "branch", "--show-current"], {
    encoding: "utf8",
    env: gitEnv(),
    killSignal: "SIGKILL",
    timeout: GIT_READ_TIMEOUT_MS,
  }).trim();
  return name.length === 0 ? undefined : name;
}

/**
 * The current branch of the checkout this process is STANDING in — never throws.
 *
 * The {@link runningCheckoutRoot} counterpart of {@link currentBranchOf}, and it exists for the same reason:
 * a runtime verb asking "which branch am I on" means the operator's checkout, not the directory its own
 * code was copied into. Answers `undefined` on a detached HEAD, and equally on a `cwd` that is no
 * repository at all — a verb that cannot name a branch is one that must say so, never one that dies.
 *
 * @param cwd the directory the process is standing in; defaults to `process.cwd()`
 * @returns the branch name, or `undefined` on a detached HEAD or a non-repository `cwd`
 */
export function runningCheckoutBranch({ cwd = process.cwd() }: { cwd?: string } = {}): string | undefined {
  let name: string;
  try {
    name = execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      env: gitEnv(),
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    }).trim();
  } catch {
    return undefined;
  }
  return name.length === 0 ? undefined : name;
}

/**
 * Every file in the working tree under `root` that git does not ignore, repo-relative, immune to an ambient
 * `GIT_DIR`.
 *
 * **Committed or not** — see the module header's rule 3 for why that is the scope rather than the index.
 * `--cached` is the index and `--others` is what is not in it, so the two are disjoint by construction and
 * their union is the working tree; `--exclude-standard` subtracts `.gitignore`, `.git/info/exclude` and the
 * global excludes, which is what keeps `node_modules/`, `dist/`, `/coverage/` and `.claude/worktrees.noindex/`
 * out of every gate's scan.
 *
 * The merged listing is SORTED because git's is not: it prints the `--others` block first and the `--cached`
 * block second, each sorted internally and the whole thing not. Gates report findings in listing order, so an
 * unsorted listing would reorder a gate's output the moment a tree went dirty.
 *
 * **`-z`, and no trim, because a path is BYTES and a line is not.** This read was newline-delimited with a
 * `.trim()` on each line, and a tracked file whose name begins with a space is printed by git unquoted —
 * so ` probe.sh` arrived as `probe.sh`, aliasing a different tracked file. Measured: with both tracked, the
 * ambient-heap-ceiling gate read the harmless `probe.sh` TWICE, never read the offender, and exited 0 while
 * `sh -c '. "./ probe.sh"'` gave a real `node` child a 320 MiB limit against a 4,288 MiB baseline. Repro:
 * `git init t && cd t && printf 'x\n' > ' a' && git add -A && git ls-files | od -c | head -2`. Every gate in
 * `src/devLint/` and `src/hygiene/scan.ts` reads its subjects through this one function, so the trim was
 * that hole in all of them at once. NUL-delimited output has no ambiguity to trim away: it also carries a
 * path containing a newline, which git would otherwise C-quote and this reader would have mangled differently.
 *
 * @param root the repository root
 * @param pathspec an optional pathspec to limit the listing (e.g. `"src"`)
 * @returns each repo-relative path, sorted, empty entries dropped
 */
export function workingTreeFilesOf({ root, pathspec }: { root: string; pathspec?: string }): readonly string[] {
  return listedFilesOf({ flags: WORKING_TREE_FLAGS, pathspecs: pathspecsOf({ pathspec }), root });
}

/**
 * The working-tree files under `root` a scan for some fixed strings has to read: every one whose bytes hold
 * one of them, plus every one git's grep cannot vouch for. A candidate SUPERSET, so a caller reads ~34 files
 * where it read every one of ~21,000, and judges each one it is handed.
 *
 * MEASURED: `recoveryChannelLiteral.test.ts` read all 21,213 `.md`/`.ts` files in its `beforeAll`, 2.6s unloaded,
 * and ran past its 20s hook timeout on a starved lap shard. Repro: `git grep -l -F --untracked -e --channels -e
 * --discover-channels -- '*.md' '*.ts' | wc -l` against `git ls-files -co --exclude-standard -- '*.md' '*.ts' | wc -l`.
 *
 * git's grep is silent where a whole read is not, and each silence is closed here rather than inherited:
 *
 *  - a nested repository, an unreadable directory or `.gitignore`: the whole tree is LISTED first through
 *    {@link listedFilesOf}, which refuses each;
 *  - a symlink (grep searches the link, Node reads its target) and a tracked file deleted from disk (grep omits
 *    it): every listed path that is not a regular file on `lstat` is returned as a candidate, so the caller's
 *    read follows or fails on it exactly as before — this helper never throws for a path it hands back;
 *  - an assume-unchanged or skip-worktree entry, which grep answers from the index: returned as a candidate too;
 *  - an unreadable file, over which grep exits 0 and writes `error:`: ANY stderr throws;
 *  - ambient config: `-F`, `-a`, `--no-textconv`, `--no-ext-grep`, `--no-recurse-submodules`, `-z` and
 *    `grep.fallbackToNoIndex=false` pin what is matched and how it is printed.
 *
 * Not atomic: a file edited between the grep and the caller's read is judged on whichever bytes it read.
 *
 * @param fixedStrings the literal byte strings, any one of which selects a file
 * @param pathspecs git pathspecs limiting the listing, as `workingTreeFilesOf`'s
 * @returns each candidate repo-relative path, sorted and distinct
 * @throws when the listing would throw, when git's grep fails, writes to stderr or answers an exit that
 *   contradicts its output, or when a string is empty or holds a NUL
 */
export function workingTreeFilesContaining({
  fixedStrings,
  pathspecs,
  root,
}: {
  fixedStrings: readonly [string, ...string[]];
  pathspecs: readonly [string, ...string[]];
  root: string;
}): readonly string[] {
  const malformed = [...fixedStrings, ...pathspecs].filter((value) => value.length === 0 || value.includes("\0"));
  if (malformed.length > 0) {
    throw new Error(`git grep refuses an empty string or one holding a NUL: ${malformed.length} given`);
  }
  // The whole tree is listed for its refusals: under `*.md` a nested repository's collapsed `inner/` entry is
  // filtered away by the pathspec itself, so only an unlimited listing still sees it and refuses.
  listedFilesOf({ flags: WORKING_TREE_FLAGS, pathspecs: [], root });
  const listed = listedFilesOf({ flags: WORKING_TREE_FLAGS, pathspecs, root });
  const patterns = fixedStrings.flatMap((value) => ["-e", value]);
  // Each pin is named in the JSDoc above: what git matches, which files it reads, and how it prints them.
  const pins = ["--full-name", "-z", "-l", "-F", "-a", "--no-ignore-case", "--no-textconv", "--no-ext-grep"];
  const scope = ["--no-color", "--no-recurse-submodules", "--untracked", "--exclude-standard"];
  const config = ["-c", "core.fsmonitor=false", "-c", "grep.fallbackToNoIndex=false"];
  const args = ["-C", root, ...config, "grep", ...pins, ...scope, ...patterns, "--", ...pathspecs];
  const grep = spawnSync("git", args, {
    encoding: "utf8",
    env: listingGitEnv(),
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
    timeout: GIT_READ_TIMEOUT_MS,
  });
  if (grep.error !== undefined) {
    throw new Error(`git grep failed under ${root}: ${grep.error.message}`);
  }
  if (grep.stderr.trim().length > 0) {
    throw new Error(`git grep wrote to stderr under ${root}, so its selection is not whole: ${grep.stderr.trim()}`);
  }
  const matched = grep.stdout.split("\0").filter((path) => path.length > 0);
  const consistent = (grep.status === 0 && matched.length > 0) || (grep.status === 1 && grep.stdout.length === 0);
  if (grep.signal !== null || !consistent) {
    throw new Error(
      `git grep failed under ${root}: signal ${String(grep.signal)}, exit ${String(grep.status)}, ${matched.length} listed`,
    );
  }
  const unvouched = listed.filter((path) => !isRegularFile({ path: join(root, path) }));
  return [...new Set([...matched, ...unvouched, ...indexTrustedPaths({ pathspecs, root })])].toSorted();
}

/**
 * The tracked paths whose working-tree bytes git's grep may never open: an assume-unchanged entry (`ls-files -v`
 * tags it lowercase) or a skip-worktree one (`S`). Without `--untracked`, grep answers both from the index, so an
 * edit on disk reads as the quiet indexed text while the caller's read sees the edit. MEASURED on git 2.54:
 * `--untracked` reads the working tree for both, so this is the guard for whichever source a git version
 * picks, not a hole seen with the flags above. Repro: mark a file `update-index --assume-unchanged`, add the
 * string on disk, then `git grep -l -F -e <it>` with and without `--untracked`.
 */
function indexTrustedPaths({ pathspecs, root }: { pathspecs: readonly string[]; root: string }): readonly string[] {
  return listedFilesOf({ flags: ["--cached", "-v"], pathspecs, root })
    .filter((entry) => /^[a-zS] /.test(entry))
    .map((entry) => entry.slice(2));
}

/** Whether a path is a regular file itself — `false` for a symlink, anything else, and anything `lstat` cannot see. */
function isRegularFile({ path }: { path: string }): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Every file git TRACKS under `root` — the index alone, no untracked file — repo-relative and sorted.
 *
 * The denominator a whole-tree count is stated over, where {@link workingTreeFilesOf} is the set a gate
 * scans: a headline reading "N of M tracked files" has to mean the same M on every checkout of one commit,
 * and a scratch file somebody left untracked would otherwise move it. Same NUL-delimited read, same refusal
 * of an empty listing.
 *
 * @param root the repository root
 * @param pathspec an optional pathspec to limit the listing
 * @returns each tracked repo-relative path, sorted
 */
export function trackedTreeFilesOf({ root, pathspec }: { root: string; pathspec?: string }): readonly string[] {
  return listedFilesOf({ flags: ["--cached"], pathspecs: pathspecsOf({ pathspec }), root });
}

/**
 * The stderr lines of an exit-0 `git ls-files` that mean its listing is short. git exits 0 over a directory
 * it could not open and only warns, so a listing with that warning is short by the subtree — review found an
 * untracked file under a mode-000 directory from door-coverage that way. An `unable to access` warning, which
 * an unreadable `.gitignore` raises, is refused too: the listing was built over a file git could not
 * read. So are git's own `error:` and `fatal:` lines. Anything else is a diagnostic over a whole listing and is
 * let through. The caller turns fsmonitor off and strips tracing, so every line here is git's own, because
 * each one reddened an honest scan. Pure.
 *
 * @param stderr everything git wrote to stderr
 * @returns each line that marks the listing partial, trimmed, in order
 */
export function partialListingLines({ stderr }: { stderr: string }): readonly string[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith("warning: could not open directory") ||
        line.startsWith("warning: unable to access") ||
        line.startsWith("error:") ||
        line.startsWith("fatal:"),
    );
}

/**
 * {@link gitEnv} as the listing's stderr check needs it. Every `GIT_TRACE*` variable is removed, so a traced
 * run's stderr carries no quoted command output to misread. The locale is pinned to C, because a translated
 * git warns `Warnung: konnte Verzeichnis … nicht öffnen` over a partial listing and no English prefix in
 * {@link partialListingLines} matches it (Homebrew git under `LC_ALL=de_DE.UTF-8`).
 */
function listingGitEnv(): NodeJS.ProcessEnv {
  const env = gitEnv();
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_TRACE") || key.startsWith("LC_") || key === "LANG" || key === "LANGUAGE") {
      delete env[key];
    }
  }
  // An ambient `GIT_*_PATHSPECS` reinterprets `*.md` (literal, case-folded, glob-only), narrowing a listing silently.
  for (const mode of ["LITERAL", "GLOB", "NOGLOB", "ICASE"]) {
    delete env[`GIT_${mode}_PATHSPECS`];
  }
  env["LC_ALL"] = "C";
  return env;
}

/** The one optional pathspec of a public listing, as the list the shared read takes. */
function pathspecsOf({ pathspec }: { pathspec: string | undefined }): readonly string[] {
  return pathspec === undefined ? [] : [pathspec];
}

/**
 * The one `git ls-files -z` read both listings share.
 *
 * @param flags which entries git lists
 * @param root the repository root
 * @param pathspecs pathspecs limiting the listing, none for the whole tree
 * @returns each repo-relative path, sorted, empty entries dropped
 * @throws when git fails, warns, lists nothing or lists a nested repository in place of its files — never a
 *   clean scan over a partial or empty listing
 */
function listedFilesOf({
  flags,
  root,
  pathspecs,
}: {
  flags: readonly string[];
  root: string;
  pathspecs: readonly string[];
}): readonly string[] {
  // No fsmonitor hook runs for this read: a hook writes what it likes to stderr, and one once printed
  // git's own warning text over a whole listing. With it off and tracing stripped, stderr is git's alone.
  const listing = ["-C", root, "-c", "core.fsmonitor=false", "ls-files", "-z", ...flags];
  const args = [...listing, ...pathspecs];
  // A full listing of a large external checkout can exceed Node's 1 MiB default `maxBuffer` and fail with
  // `ENOBUFS` — measured on acme-admin's ~16,400 tracked files, whose unfiltered listing is over 1.1 MB. That
  // failure was silently swallowed by every caller's `catch`, so `handover check` reported every real file in
  // that repository as uncommitted. 64 MiB comfortably covers a repository an order of magnitude larger.
  const listed = spawnSync("git", args, {
    encoding: "utf8",
    env: listingGitEnv(),
    maxBuffer: 64 * 1024 * 1024,
    killSignal: "SIGKILL",
    timeout: GIT_READ_TIMEOUT_MS,
  });
  if (listed.error !== undefined) {
    throw new Error(`git ls-files failed under ${root}: ${listed.error.message}`);
  }
  if (listed.signal !== null || listed.status !== 0) {
    throw new Error(
      `git ls-files failed under ${root}: signal ${String(listed.signal)}, exit ${String(listed.status)}: ${listed.stderr.trim()}`,
    );
  }
  const partial = partialListingLines({ stderr: listed.stderr });
  if (partial.length > 0) {
    throw new Error(`git ls-files warned under ${root}, so the listing is partial: ${partial.join("; ")}`);
  }
  const files = listed.stdout
    .split("\0")
    .filter((path) => path.length > 0)
    .toSorted();
  // A listing of NOTHING is a fault, never a clean bill. This repository always holds files, so an empty
  // result means the listing was redirected or the index was unreadable — and a gate that scans zero files
  // reports clean, which is the failure mode this whole module exists to prevent.
  if (files.length === 0) {
    throw new Error(`git ls-files listed no files under ${root} — refusing to report a clean scan`);
  }
  // An untracked directory holding its own `.git` is listed as ONE entry ending in `/`, with exit 0 and no
  // warning, and none of its files: review found a `.ts` file hidden from every source gate under `src/hidden/.git`.
  // Repro: `git init t && cd t && touch a && git add a && git init -q n && touch n/b && git ls-files -o`.
  const collapsed = files.filter((path) => path.endsWith("/"));
  if (collapsed.length > 0) {
    throw new Error(
      `git ls-files listed ${collapsed.join(", ")} as a nested repository, not its files, so the listing is partial`,
    );
  }
  return files;
}
